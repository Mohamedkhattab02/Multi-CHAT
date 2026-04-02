// ============================================================
// Rolling Summary — Layer 6 of 7-layer memory system
// Generates a compressed summary of the conversation so far
// Used to maintain context in very long conversations
// Uses GLM (cheapest) for summarization
// ============================================================

import * as Sentry from '@sentry/nextjs';

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
    const response = await fetch('https://open.bigmodel.cn/api/v4/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'glm-4-7b',
        max_tokens: 800,
        messages: [
          {
            role: 'system',
            content: 'You are a conversation summarizer. Create concise, information-dense summaries that capture the key points, decisions, and context of conversations. Write in third person.',
          },
          { role: 'user', content: prompt },
        ],
      }),
    });

    if (!response.ok) throw new Error(`GLM summary error: ${response.status}`);

    const data = await response.json();
    return data.choices?.[0]?.message?.content || previousSummary || '';
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
    const response = await fetch('https://open.bigmodel.cn/api/v4/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'glm-4-7b',
        max_tokens: 30,
        messages: [
          {
            role: 'system',
            content: 'Generate a short conversation title (3-6 words, no quotes). Based on the user message and response.',
          },
          {
            role: 'user',
            content: `User: ${userMessage.slice(0, 200)}\nAssistant: ${assistantResponse.slice(0, 200)}`,
          },
        ],
      }),
    });

    if (!response.ok) throw new Error(`GLM title error: ${response.status}`);

    const data = await response.json();
    const title = data.choices?.[0]?.message?.content?.trim();
    return title?.slice(0, 100) || 'New conversation';
  } catch {
    return 'New conversation';
  }
}
