// ============================================================
// Memory Invalidation — Layer 0 of V4 memory system
// Catches explicit invalidations BEFORE search runs
// Detects "forget that", "that's wrong", corrections in EN/HE/AR
// ============================================================

import { createServiceClient } from '@/lib/supabase/server';
import { generateEmbedding } from '@/lib/ai/embeddings';
import * as Sentry from '@sentry/nextjs';

const INVALIDATION_PATTERNS = [
  // English
  /\b(forget|ignore|disregard|nevermind|never mind|scratch that)\b.{0,40}\b(that|what i said|previous|last)\b/i,
  /\b(that'?s wrong|that was wrong|incorrect|not right|actually)\b/i,
  /\b(the (previous|last|earlier) (solution|answer|code) (didn'?t work|was wrong|failed))\b/i,
  // Hebrew
  /\b(תשכח|תתעלם|לא חשוב|עזוב)\b.{0,40}\b(מה שאמרתי|הקודם|זה|את זה)\b/,
  /\b(זה (לא נכון|טעות|לא עובד))\b/,
  /\b(הפתרון הקודם (לא עבד|לא נכון|שגוי))\b/,
  // Arabic
  /\b(انسى|تجاهل|مش مهم)\b/,
];

export async function detectAndHandleInvalidation(
  userId: string,
  conversationId: string,
  message: string
): Promise<{ invalidated: boolean; count: number }> {
  const isInvalidation = INVALIDATION_PATTERNS.some(p => p.test(message));
  if (!isInvalidation) return { invalidated: false, count: 0 };

  try {
    const supabase = createServiceClient();

    // Find the target: pull last 3 assistant messages from this conversation
    const { data: recentAssistant } = await supabase
      .from('messages')
      .select('id, content, created_at')
      .eq('conversation_id', conversationId)
      .eq('role', 'assistant')
      .order('created_at', { ascending: false })
      .limit(3);

    if (!recentAssistant?.length) return { invalidated: false, count: 0 };

    // Invalidate embeddings linked to those message IDs via metadata
    const messageIds = recentAssistant.map(m => m.id);
    let invalidatedCount = 0;

    for (const msgId of messageIds) {
      const { data: updated } = await supabase
        .from('embeddings')
        .update({
          metadata: {
            is_active: false,
            invalidated_at: new Date().toISOString(),
          },
        })
        .eq('source_id', msgId)
        .eq('user_id', userId)
        .select('id');

      invalidatedCount += updated?.length ?? 0;
    }

    // Record the invalidation as an anti-memory
    await supabase.from('memories').insert({
      user_id: userId,
      type: 'anti_memory',
      content: `User invalidated: "${message.slice(0, 200)}"`,
      confidence: 1.0,
      source_conversation_id: conversationId,
    });

    // Also embed the anti-memory for RAG retrieval
    const embedding = await generateEmbedding(
      `INVALIDATED: ${message.slice(0, 500)}`
    );
    await supabase.from('embeddings').insert({
      user_id: userId,
      source_type: 'anti_memory',
      content: `User invalidated: "${message.slice(0, 200)}"`,
      embedding,
      metadata: {
        conversation_id: conversationId,
        is_active: true,
      },
    });

    return { invalidated: true, count: invalidatedCount };
  } catch (error) {
    Sentry.captureException(error, {
      tags: { action: 'memory_invalidation' },
    });
    console.error('[Invalidation] Failed:', error);
    return { invalidated: false, count: 0 };
  }
}
