import { generateEmbedding } from '@/lib/ai/embeddings';
import { createClient } from '@supabase/supabase-js';

const INVALIDATION_PATTERNS = [
  /\b(תשכח|תתעלם|תמחק|forget|ignore|disregard|delete memory)\b/i,
  /\b(שיניתי דעה|changed my mind|לא נכון|not relevant anymore|strike that)\b/i,
];

export async function checkAndInvalidateMemories(
  userId: string,
  message: string,
  conversationId: string
): Promise<{ invalidated: boolean; count: number }> {
  if (!INVALIDATION_PATTERNS.some(p => p.test(message))) {
    return { invalidated: false, count: 0 };
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  try {
    const embedding = await generateEmbedding(message);
    const { data: related } = await supabase.rpc('hybrid_search', {
      query_text: message,
      query_embedding: embedding,
      target_user_id: userId,
      match_count: 5,
    });

    if (!related || related.length === 0) {
      return { invalidated: false, count: 0 };
    }

    const factIds = related
      .filter((r: any) => r.source_type === 'fact' || r.source_type === 'preference')
      .map((r: any) => r.source_id)
      .filter(Boolean);

    if (factIds.length === 0) {
      return { invalidated: false, count: 0 };
    }

    // Insert the rejection memory itself
    await supabase.from('memories').insert({
      user_id: userId,
      type: 'rejection',
      content: `User invalidated: "${message.slice(0, 300)}"`,
      confidence: 0.95,
      source_conversation_id: conversationId,
      is_active: true,
    });

    // Deactivate the old memories
    // For each embedding, we need to mark metadata.is_active = false
    // Supabase JS doesn't support JSONB path updates, so we use RPC or fetch each row
    // The simplest correct approach: deactivate the memories and let the SQL filter handle it
    for (const factId of factIds) {
      const { data: emb } = await supabase
        .from('embeddings')
        .select('id, metadata')
        .eq('source_id', factId)
        .eq('source_type', 'fact');

      if (emb) {
        for (const e of emb) {
          await supabase
            .from('embeddings')
            .update({ metadata: { ...e.metadata, is_active: false } })
            .eq('id', e.id);
        }
      }
    }

    await supabase
      .from('memories')
      .update({ is_active: false })
      .in('id', factIds);

    return { invalidated: true, count: factIds.length };
  } catch (error) {
    console.error('[Invalidation] Error:', error);
    return { invalidated: false, count: 0 };
  }
}