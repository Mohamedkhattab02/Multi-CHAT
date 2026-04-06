// ============================================================
// Anti-Memory — V4
// Stores explicit rejections so the model never suggests the
// same wrong thing twice. Runs in Layer 5 post-processing.
// ============================================================

import { createServiceClient } from '@/lib/supabase/server';
import { generateEmbedding } from '@/lib/ai/embeddings';
import * as Sentry from '@sentry/nextjs';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

const REJECTION_PATTERNS = [
  /(?:didn'?t work|doesn'?t work|not working|failed|wrong|incorrect)/i,
  /(?:לא עבד|לא עובד|נכשל|שגוי|לא נכון)/,
  /(?:مش شغال|غلط|ما اشتغل)/,
];

/**
 * Detect if the user is rejecting the previous suggestion.
 * If so, record an anti-memory to prevent repeating the mistake.
 */
export async function detectAntiMemory(
  userMessage: string,
  previousAssistantResponse: string,
  userId: string,
  conversationId: string
): Promise<void> {
  if (!REJECTION_PATTERNS.some(p => p.test(userMessage))) return;

  try {
    const supabase = createServiceClient();

    // Use Gemini Flash to summarize what was rejected and why
    const response = await fetch(GEMINI_API_BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': process.env.GOOGLE_AI_API_KEY!,
      },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [{
            text: `The user rejected something. Summarize what was rejected and why.
Previous assistant response: "${previousAssistantResponse.slice(0, 1000)}"
User's rejection: "${userMessage.slice(0, 500)}"

Return JSON: { "rejected": "what was rejected", "reason": "why", "avoid_pattern": "what to not do again" }`,
          }],
        }],
        generationConfig: {
          maxOutputTokens: 300,
          temperature: 0,
          responseMimeType: 'application/json',
        },
      }),
    });

    if (!response.ok) throw new Error(`Gemini error: ${response.status}`);

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const summary = JSON.parse(text);

    const antiMemoryContent = `REJECTED: ${summary.rejected || 'unknown'}. Reason: ${summary.reason || 'unknown'}. Avoid: ${summary.avoid_pattern || 'unknown'}`;

    // Store the anti-memory
    const { data: inserted } = await supabase.from('memories').insert({
      user_id: userId,
      type: 'anti_memory',
      content: antiMemoryContent,
      confidence: 0.95,
      source_conversation_id: conversationId,
    }).select('id').single();

    // Also embed it so RAG can surface it
    if (inserted) {
      const embedding = await generateEmbedding(antiMemoryContent);
      await supabase.from('embeddings').insert({
        user_id: userId,
        source_type: 'anti_memory',
        source_id: inserted.id,
        content: antiMemoryContent,
        embedding,
        metadata: {
          conversation_id: conversationId,
          is_active: true,
        },
      });
    }
  } catch (error) {
    Sentry.captureException(error, {
      tags: { action: 'anti_memory_detection' },
    });
    console.error('[AntiMemory] Failed:', error);
  }
}
