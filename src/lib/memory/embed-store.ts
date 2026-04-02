// ============================================================
// Embed & Store — saves message embeddings to Supabase
// Runs in background after each message (fire and forget)
// Enables RAG retrieval for future conversations
// ============================================================

import { createServiceClient } from '@/lib/supabase/server';
import { generateEmbedding } from '@/lib/ai/embeddings';

/**
 * Generate an embedding for a message and store it in the embeddings table.
 * This allows hybrid_search to find relevant past messages for RAG context.
 */
export async function storeMessageEmbedding(
  userId: string,
  content: string,
  conversationId: string,
  role: 'user' | 'assistant'
): Promise<void> {
  // Skip very short messages (greetings etc.) — not useful for RAG
  if (content.trim().length < 20) return;

  const supabase = createServiceClient();
  const embedding = await generateEmbedding(content);

  await supabase.from('embeddings').insert({
    user_id: userId,
    source_type: 'message',
    source_id: conversationId,
    content: content.slice(0, 8000), // match embedding input limit
    embedding,
    metadata: {
      role,
      conversation_id: conversationId,
    },
  });
}
