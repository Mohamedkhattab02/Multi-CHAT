// ============================================================
// Conversation Fingerprinting — V4
// 256-dim fingerprint per conversation for fast pre-filtering
// Narrows search space from all embeddings to ~10 conversations
// ============================================================

import { createServiceClient } from '@/lib/supabase/server';
import { generateEmbedding } from '@/lib/ai/embeddings';
import * as Sentry from '@sentry/nextjs';

/**
 * Update the conversation fingerprint (256-dim truncated vector).
 * Triggered every 20 messages in post-processing.
 */
export async function updateConversationFingerprint(
  conversationId: string
): Promise<void> {
  try {
    const supabase = createServiceClient();

    const { data: convo } = await supabase
      .from('conversations')
      .select('title, topic, structured_summary, key_topics, key_entities')
      .eq('id', conversationId)
      .single();

    if (!convo) return;

    // Build fingerprint text from conversation metadata
    const summary = convo.structured_summary as Record<string, unknown> | null;
    const parts: string[] = [
      convo.title || '',
      convo.topic || '',
    ];

    if (summary) {
      if (summary.narrative) parts.push(String(summary.narrative));
      if (Array.isArray(summary.technical)) {
        parts.push(...(summary.technical as string[]).slice(0, 5));
      }
      if (Array.isArray(summary.decisions)) {
        parts.push(...(summary.decisions as string[]).slice(0, 5));
      }
    }

    if (Array.isArray(convo.key_topics)) {
      parts.push(...convo.key_topics.slice(0, 5));
    }

    const fingerprintText = parts.filter(Boolean).join(' | ');
    if (!fingerprintText.trim()) return;

    const fullEmbedding = await generateEmbedding(fingerprintText);
    // Truncate to 256 dims for fast coarse filtering
    const fingerprint = fullEmbedding.slice(0, 256);

    await supabase
      .from('conversations')
      .update({ fingerprint })
      .eq('id', conversationId);
  } catch (error) {
    Sentry.captureException(error, {
      tags: { action: 'conversation_fingerprint' },
    });
    console.error('[Fingerprint] Failed:', error);
  }
}

/**
 * Find the most relevant conversations for a query using fingerprint similarity.
 * Always includes the current conversation.
 */
export async function findRelevantConversations(params: {
  userId: string;
  queryEmbedding: number[];
  topK: number;
  currentConversationId: string;
}): Promise<string[]> {
  try {
    const supabase = createServiceClient();
    const truncated = params.queryEmbedding.slice(0, 256);

    const { data } = await supabase.rpc('search_similar_conversations', {
      query_embedding_256: truncated,
      target_user_id: params.userId,
      match_count: params.topK,
    });

    const ids = data?.map((c: { id: string }) => c.id) ?? [];
    if (!ids.includes(params.currentConversationId)) {
      ids.unshift(params.currentConversationId);
    }
    return ids;
  } catch (error) {
    Sentry.captureException(error, {
      tags: { action: 'find_relevant_conversations' },
    });
    // Fallback: just search current conversation
    return [params.currentConversationId];
  }
}
