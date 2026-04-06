// ============================================================
// Embed & Store — V4
// Saves message embeddings to Supabase for RAG retrieval
// V4: Pre-embed support, temp→permanent promotion, importance scoring
// ============================================================

import { createServiceClient } from '@/lib/supabase/server';
import { generateEmbedding } from '@/lib/ai/embeddings';
import { computeDensity } from '@/lib/memory/token-density';

/**
 * Store a message embedding permanently.
 * This is the standard path for assistant responses and finalized user messages.
 */
export async function storeMessageEmbedding(
  userId: string,
  content: string,
  conversationId: string,
  role: 'user' | 'assistant'
): Promise<void> {
  if (content.trim().length < 10) return;

  const supabase = createServiceClient();
  const embedding = await generateEmbedding(content);
  const importance = computeDensity(content);

  await supabase.from('embeddings').insert({
    user_id: userId,
    source_type: 'message',
    source_id: conversationId,
    content: content.slice(0, 8000),
    embedding,
    metadata: {
      role,
      conversation_id: conversationId,
      is_active: true,
      is_current_message: false,
      importance,
    },
  });
}

/**
 * Promote a pre-embedded temp message to permanent storage.
 * Called in post-processing after the response streams.
 * Clears the is_current_message flag so it doesn't get filtered out.
 */
export async function promoteTempEmbedding(
  tempMessageId: number | null
): Promise<void> {
  if (!tempMessageId) return;

  const supabase = createServiceClient();
  // Update the temp embedding to be permanent
  await supabase
    .from('embeddings')
    .update({
      metadata: {
        is_current_message: false,
        is_active: true,
      },
    } as Record<string, unknown>)
    .eq('id', tempMessageId);
}

/**
 * Store an embedding for an extracted memory/fact.
 */
export async function storeMemoryEmbedding(
  userId: string,
  memoryId: string,
  content: string,
  conversationId: string,
  sourceType: 'fact' | 'anti_memory' = 'fact'
): Promise<void> {
  if (content.trim().length < 5) return;

  const supabase = createServiceClient();
  const embedding = await generateEmbedding(content);

  await supabase.from('embeddings').insert({
    user_id: userId,
    source_type: sourceType,
    source_id: memoryId,
    content: content.slice(0, 8000),
    embedding,
    metadata: {
      conversation_id: conversationId,
      is_active: true,
    },
  });
}
