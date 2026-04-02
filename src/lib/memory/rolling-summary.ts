// ============================================================
// Rolling Summary — Layer 6 of 7-layer memory system
// Generates a compressed summary of the conversation so far
// Used to maintain context in very long conversations
// Uses Gemini 2.0 Flash (fast, non-thinking) for summarization
// ============================================================

import * as Sentry from '@sentry/nextjs';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

async function callGeminiFlash(systemInstruction: string, userMessage: string, maxTokens: number): Promise<string> {
  const response = await fetch(GEMINI_API_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': process.env.GOOGLE_AI_API_KEY!,
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: systemInstruction }],
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: userMessage }],
        },
      ],
      generationConfig: {
        maxOutputTokens: maxTokens,
      },
    }),
  });

  if (!response.ok) throw new Error(`Gemini Flash error: ${response.status}`);

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

export async function generateRollingSummary(
  previousSummary: string | null | undefined,
  recentMessages: Array<{ role: string; content: string }>,
  latestUserMessage: string,
  latestAssistantResponse: string
): Promise<string> {
  const conversation = recentMessages
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.slice(0, 300)}`)
    .join('\n');

  const prompt = previousSummary
    ? `Previous summary:\n${previousSummary}\n\nNew messages:\n${conversation}\nUser: ${latestUserMessage.slice(0, 500)}\nAssistant: ${latestAssistantResponse.slice(0, 500)}\n\nUpdate the summary to include the new information. Keep it under 500 words. Focus on key facts, decisions, and context that would be useful for future messages.`
    : `Conversation:\n${conversation}\nUser: ${latestUserMessage.slice(0, 500)}\nAssistant: ${latestAssistantResponse.slice(0, 500)}\n\nCreate a concise summary (under 500 words) of this conversation. Focus on key facts, decisions, topics discussed, and context that would be useful for future messages.`;

  try {
    const result = await callGeminiFlash(
      'You are a conversation summarizer. Create concise, information-dense summaries that capture the key points, decisions, and context of conversations. Write in third person.',
      prompt,
      800
    );
    return result || previousSummary || '';
  } catch (error) {
    Sentry.captureException(error, {
      tags: { action: 'rolling_summary' },
    });
    console.error('[RollingSummary] Failed:', error);
    return previousSummary || '';
  }
}

export async function generateTitle(
  userMessage: string,
  assistantResponse: string
): Promise<string> {
  try {
    const result = await callGeminiFlash(
      'Generate a short conversation title (3-6 words, no quotes). Based on the user message and response.',
      `User: ${userMessage.slice(0, 200)}\nAssistant: ${assistantResponse.slice(0, 200)}`,
      30
    );
    return result?.trim()?.slice(0, 100) || 'New conversation';
  } catch {
    return 'New conversation';
  }
}
