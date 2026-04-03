// ============================================================
// RAG Pipeline — Layer 2 of 7-layer memory system
// Hybrid search: pgvector + tsvector + pg_trgm via Supabase RPC
// Then MANDATORY Voyage AI Reranking for accuracy boost
//
// KEY DESIGN: Since we only send the last 5 messages as direct
// context, RAG is the primary way to access older conversation
// history. It retrieves relevant past messages, extracted facts,
// and summaries — making long conversations work efficiently.
// ============================================================

import { createServiceClient } from '@/lib/supabase/server';
import { generateEmbedding } from '@/lib/ai/embeddings';
import { rerankResults } from '@/lib/ai/reranker';
import type { Json } from '@/lib/supabase/types';

interface HybridSearchResult {
  id: number;
  content: string;
  source_type: string;
  metadata: Json;
  created_at: string;
  score: number;
  [key: string]: unknown;
}

function getMetaConversationId(metadata: Json): string | undefined {
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    const val = (metadata as Record<string, Json | undefined>).conversation_id;
    return typeof val === 'string' ? val : undefined;
  }
  return undefined;
}

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

/**
 * Retrieve relevant memories for a user query via hybrid search + reranking.
 *
 * @param userId - The user's ID
 * @param message - The current user message (search query)
 * @param topK - Number of final results to return (default 8)
 * @param conversationId - Optional: prioritize results from this conversation
 * @returns Formatted string of relevant memories for system prompt injection
 */
export async function retrieveMemories(
  userId: string,
  message: string,
  topK: number = 8,
  conversationId?: string
): Promise<string> {
  const supabase = createServiceClient();

  // 1. Generate embedding for the query
  const embedding = await generateEmbedding(message);

  // 2. Hybrid search via Supabase RPC — fetch more candidates for reranking
  const candidateCount = topK * 3;

  const { data: results, error } = await supabase.rpc('hybrid_search', {
    query_text: message,
    query_embedding: embedding,
    target_user_id: userId,
    match_count: candidateCount,
    full_text_weight: 1.0,
    semantic_weight: 1.5,
    fuzzy_weight: 0.5,
  });

  if (error || !results?.length) return '';

  // 3. If conversationId provided, boost results from the same conversation
  // This ensures intra-conversation recall is prioritized
  let candidates: HybridSearchResult[] = results as HybridSearchResult[];
  if (conversationId) {
    candidates = (results as HybridSearchResult[]).map((r) => ({
      ...r,
      // Prefix same-conversation results so reranker sees them as more relevant
      content: getMetaConversationId(r.metadata) === conversationId
        ? `[Current conversation] ${r.content}`
        : r.content,
    }));
  }

  // 4. MANDATORY Voyage AI Reranking — this is what makes RAG accurate
  const reranked = await rerankResults(message, candidates, topK);

  // 5. Format results for context injection
  // Group by source type for clearer context
  const memories: string[] = [];
  const conversationMemories: string[] = [];
  const factMemories: string[] = [];

  for (const r of reranked) {
    const timeAgo = formatTimeAgo(String(r.created_at));
    const cleanContent = String(r.content).replace(/^\[Current conversation\] /, '');
    const isCurrentConv = getMetaConversationId(r.metadata as Json) === conversationId;

    if (r.source_type === 'fact' || r.source_type === 'document') {
      factMemories.push(`• ${cleanContent}`);
    } else if (isCurrentConv) {
      conversationMemories.push(`[${timeAgo}] ${cleanContent}`);
    } else {
      memories.push(`[${r.source_type}, ${timeAgo}] ${cleanContent}`);
    }
  }

  const sections: string[] = [];

  if (conversationMemories.length > 0) {
    sections.push(
      '📌 Earlier in this conversation:\n' + conversationMemories.join('\n')
    );
  }

  if (factMemories.length > 0) {
    sections.push(
      '🧠 Known facts about user:\n' + factMemories.join('\n')
    );
  }

  if (memories.length > 0) {
    sections.push(
      '📚 From past conversations:\n' + memories.join('\n')
    );
  }

  return sections.join('\n\n');
}
