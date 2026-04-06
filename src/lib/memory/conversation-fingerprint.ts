import { generateEmbedding } from '@/lib/ai/embeddings';
import { createClient } from '@supabase/supabase-js';

export async function updateFingerprint(
  conversationId: string,
  userId: string
): Promise<void> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: messages } = await supabase
    .from('messages')
    .select('content')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  if (!messages || messages.length === 0) return;

  // Compact: 100 chars per message, max 3000 chars total
  const compact = messages
    .map((m: any) => m.content.slice(0, 100))
    .join(' ')
    .slice(0, 3000);

  try {
    const fullEmbedding = await generateEmbedding(compact);
    // Truncate to 256 dims (Postgres allows casting/ slicing implicitly via API)
    const embedding256 = fullEmbedding.slice(0, 256);

    await supabase
      .from('conversations')
      .update({ fingerprint: embedding256 })
      .eq('id', conversationId);
  } catch (error) {
    console.error('[Fingerprint] Update failed:', error);
  }
}

export async function findSimilarConversations(
  queryEmbedding: number[], 
  userId: string
): Promise<string[]> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  
  const embedding256 = queryEmbedding.slice(0, 256);
  
  const { data } = await supabase.rpc('search_similar_conversations', {
    query_embedding_256: embedding256,
    target_user_id: userId,
    match_count: 3,
  });

  return (data || []).map((c: any) => c.id);
}