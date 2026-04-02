// ============================================================
// RAG Pipeline — Layer 2 of 7-layer memory system
// Hybrid search: pgvector + tsvector + pg_trgm via Supabase RPC
// Then MANDATORY Voyage AI Reranking for accuracy boost
// ============================================================

import { createServiceClient } from '@/lib/supabase/server';
import { generateEmbedding } from '@/lib/ai/embeddings';
import { rerankResults } from '@/lib/ai/reranker';

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export async function retrieveMemories(
  userId: string,
  message: string,
  topK: number = 5
): Promise<string> {
  const supabase = createServiceClient();

  // 1. Generate embedding for the query
  const embedding = await generateEmbedding(message);

  // 2. Hybrid search via Supabase RPC — fetch more candidates for reranking
  const { data: results, error } = await supabase.rpc('hybrid_search', {
    query_text: message,
    query_embedding: embedding,
    target_user_id: userId,
    match_count: topK * 3,
    full_text_weight: 1.0,
    semantic_weight: 1.5,
    fuzzy_weight: 0.5,
  });

  if (error || !results?.length) return '';

  // 3. MANDATORY Voyage AI Reranking
  const reranked = await rerankResults(message, results, topK);

  // 4. Format results for context injection
  return reranked
    .map(
      (r, i) =>
        `[Memory ${i + 1}] (${r.source_type}, ${formatTimeAgo(r.created_at)}): ${r.content}`
    )
    .join('\n\n');
}
