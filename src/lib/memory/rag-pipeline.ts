// ============================================================
// RAG Pipeline — V4 (8-step pipeline)
// Step 1: Pre-embed current message
// Step 2: Query expansion (HyDE + multi-query)
// Step 3: Conversation fingerprint filter
// Step 4: Hybrid search with adaptive weights
// Step 5: Remove current message from results
// Step 6: Assign memory temperature (HOT/WARM/COLD)
// Step 7: Voyage AI reranking (mandatory)
// Step 8: Filter active only
// Step 9: Dedicated document chunk retrieval (vector similarity)
// ============================================================

import { createServiceClient } from '@/lib/supabase/server';
import { generateEmbedding } from '@/lib/ai/embeddings';
import { rerankResults } from '@/lib/ai/reranker';
import { computeAdaptiveWeights } from '@/lib/memory/adaptive-weights';
import { computeMemoryTemperature, type Temperature } from '@/lib/memory/memory-temperature';
import { expandQuery } from '@/lib/memory/query-expander';
import { findRelevantConversations } from '@/lib/memory/conversation-fingerprint';
import type { ClassificationResult } from '@/lib/ai/classifier';
import type { Json } from '@/lib/supabase/types';
import * as Sentry from '@sentry/nextjs';

export interface RetrievedResult {
  id: number;
  content: string;
  source_type: string;
  source_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  score: number;
  temperature: Temperature;
}

export interface RetrievedContext {
  hot: RetrievedResult[];
  warm: RetrievedResult[];
  cold: RetrievedResult[];
  documentChunks: RetrievedResult[];
  documentRegistry: Array<{ filename: string; summary: string }>;
  tempMessageId: number | null;
}

// ═══════════════════════════════════════════════════════════
// Cosine Similarity
// ═══════════════════════════════════════════════════════════

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ═══════════════════════════════════════════════════════════
// Fetch document registry from DB (self-sufficient)
// ═══════════════════════════════════════════════════════════

async function fetchDocumentRegistry(
  supabase: ReturnType<typeof createServiceClient>,
  conversationId: string
): Promise<Array<{ filename: string; summary: string }>> {
  try {
    const { data } = await supabase
      .from('conversations')
      .select('document_registry')
      .eq('id', conversationId)
      .single();

    if (!data?.document_registry) return [];
    const raw = data.document_registry as unknown[];
    if (!Array.isArray(raw)) return [];

    return raw
      .filter((item): item is Record<string, unknown> =>
        item !== null && typeof item === 'object'
      )
      .map(item => ({
        filename: String(item.filename || ''),
        summary: String(item.summary || ''),
      }))
      .filter(item => item.filename.length > 0);
  } catch {
    return [];
  }
}

// ═══════════════════════════════════════════════════════════
// Main RAG Pipeline
// ═══════════════════════════════════════════════════════════

/**
 * V4 RAG Pipeline — self-sufficient: fetches document_registry
 * from DB if not provided by caller. No dependency on chat route
 * passing the correct params.
 */
export async function retrieveMemories(params: {
  userId: string;
  conversationId: string;
  message: string;
  conversationContext: string;
  classification: ClassificationResult;
  topK?: number;
  documentRegistry?: Array<{ filename: string; summary: string }>;
}): Promise<RetrievedContext> {
  const { userId, conversationId, message, classification, topK = 12 } = params;
  const supabase = createServiceClient();

  // ═══ SELF-SUFFICIENT: fetch document registry if caller didn't provide ═══
  // This is the fix for the bug where document chunks were never retrieved
  // because the chat route didn't pass documentRegistry.
  let documentRegistry = params.documentRegistry;
  if (!documentRegistry) {
    documentRegistry = await fetchDocumentRegistry(supabase, conversationId);
  }

  // ═══ STEP 1: PRE-EMBED current message ═══
  const currentMessageEmbedding = await generateEmbedding(message);
  let tempMessageId: number | null = null;

  try {
    const { data: tempEmbed } = await supabase.from('embeddings').insert({
      user_id: userId,
      source_type: 'message',
      content: message.slice(0, 8000),
      embedding: currentMessageEmbedding,
      metadata: {
        conversation_id: conversationId,
        role: 'user',
        is_current_message: true,
        is_active: true,
      },
    }).select('id').single();
    tempMessageId = tempEmbed?.id ?? null;
  } catch (err) {
    Sentry.captureException(err, { tags: { action: 'pre_embed' } });
  }

  // ═══ STEP 2: Query Expansion (HyDE + multi-query) ═══
  const expandedQueries = await expandQuery({
    original: message,
    context: params.conversationContext,
    language: classification.language,
  });

  // ═══ STEP 3: Conversation Fingerprint filter ═══
  let relevantConversationIds: string[] | null = null;
  try {
    relevantConversationIds = await findRelevantConversations({
      userId,
      queryEmbedding: currentMessageEmbedding,
      topK: 10,
      currentConversationId: conversationId,
    });
  } catch {
    // Fallback: no fingerprint filtering (search all)
  }

  // ═══ STEP 4: Hybrid search with ADAPTIVE WEIGHTS ═══
  const weights = computeAdaptiveWeights({
    intent: classification.intent,
    language: classification.language,
    hasCodeMarkers: classification.hasCodeMarkers ?? false,
  });

  const allResults = new Map<number, RetrievedResult>();
  const candidateCount = topK * 3;

  for (const query of expandedQueries) {
    const queryEmbedding = query === message
      ? currentMessageEmbedding
      : await generateEmbedding(query);

    try {
      let data;
      if (relevantConversationIds) {
        const result = await supabase.rpc('hybrid_search_scoped', {
          query_text: query,
          query_embedding: queryEmbedding,
          target_user_id: userId,
          conversation_ids: relevantConversationIds,
          match_count: candidateCount,
          full_text_weight: weights.fulltext,
          semantic_weight: weights.semantic,
          fuzzy_weight: weights.fuzzy,
        });
        data = result.data;
      } else {
        const result = await supabase.rpc('hybrid_search', {
          query_text: query,
          query_embedding: queryEmbedding,
          target_user_id: userId,
          match_count: candidateCount,
          full_text_weight: weights.fulltext,
          semantic_weight: weights.semantic,
          fuzzy_weight: weights.fuzzy,
        });
        data = result.data;
      }

      if (data) {
        for (const r of data as Array<{
          id: number;
          content: string;
          source_type: string;
          source_id?: string;
          metadata: Json;
          created_at: string;
          score: number;
        }>) {
          const existing = allResults.get(r.id);
          if (!existing || r.score > existing.score) {
            allResults.set(r.id, {
              id: r.id,
              content: r.content,
              source_type: r.source_type,
              source_id: r.source_id ?? null,
              metadata: (r.metadata && typeof r.metadata === 'object' && !Array.isArray(r.metadata)
                ? r.metadata as Record<string, unknown>
                : {}) as Record<string, unknown>,
              created_at: r.created_at,
              score: r.score,
              temperature: 'cold',
            });
          }
        }
      }
    } catch (err) {
      Sentry.captureException(err, { tags: { action: 'hybrid_search' } });
    }
  }

  // ═══ STEP 5: Remove current message from results ═══
  if (tempMessageId) {
    allResults.delete(tempMessageId);
  }

  // ═══ STEP 6: Assign MEMORY TEMPERATURE ═══
  const withTemperature = Array.from(allResults.values()).map(r => ({
    ...r,
    temperature: computeMemoryTemperature(r, classification, conversationId),
  }));

  // ═══ STEP 7: Voyage AI Reranking (MANDATORY) ═══
  const reranked = await rerankResults(message, withTemperature, topK);

  // ═══ STEP 8: Filter active only (defense in depth) ═══
  const active = reranked.filter(r => {
    const meta = r.metadata ?? {};
    return meta.is_active !== false;
  });

  // ═══ STEP 9: DEDICATED DOCUMENT CHUNK RETRIEVAL ═══
  let documentChunks: RetrievedResult[] = [];
  const hasDocumentsInConversation = documentRegistry.length > 0;

  if (hasDocumentsInConversation || classification.referencesDocument || active.some(r => r.source_type === 'document')) {
    try {
      documentChunks = await retrieveDocumentChunks({
        userId,
        conversationId,
        message,
        queryEmbedding: currentMessageEmbedding,
        supabase,
      });

      // Log for debugging — helps verify documents are being retrieved
      if (hasDocumentsInConversation && documentChunks.length === 0) {
        console.warn(
          `[RAG] Document registry has ${documentRegistry.length} files but 0 chunks retrieved for: "${message.slice(0, 80)}"`
        );
      } else if (documentChunks.length > 0) {
        console.log(
          `[RAG] Retrieved ${documentChunks.length} document chunks from ${new Set(documentChunks.map(c => c.metadata?.file_name)).size} files`
        );
      }
    } catch (err) {
      Sentry.captureException(err, { tags: { action: 'document_retrieval' } });
    }
  }

  // Remove document chunks from regular tiers (they get their own section)
  const nonDocActive = active.filter(r => r.source_type !== 'document');

  return {
    hot: nonDocActive.filter(r => r.temperature === 'hot'),
    warm: nonDocActive.filter(r => r.temperature === 'warm'),
    cold: nonDocActive.filter(r => r.temperature === 'cold'),
    documentChunks,
    documentRegistry, // ← NOW ALWAYS INCLUDED in return value
    tempMessageId,
  };
}

// ═══════════════════════════════════════════════════════════
// Dedicated Document Chunk Retrieval
// ═══════════════════════════════════════════════════════════

/**
 * Dedicated document chunk retrieval.
 * Uses PostgreSQL RPC for vector similarity — does NOT fetch
 * the embedding column to JS (PostgREST drops vector columns).
 * Then fetches neighbor chunks by metadata for reading context.
 */
async function retrieveDocumentChunks(params: {
  userId: string;
  conversationId: string;
  message: string;
  queryEmbedding: number[];
  supabase: ReturnType<typeof createServiceClient>;
}): Promise<RetrievedResult[]> {
  const { userId, conversationId, queryEmbedding, supabase } = params;

  // ═══ 1. RPC: similarity computed in PostgreSQL ═══
  type UntypedRpc = {
    rpc: (fn: string, params: Record<string, unknown>) => Promise<{
      data: unknown;
      error: { message: string } | null;
    }>;
  };
  const rpc = supabase as unknown as UntypedRpc;

  const rpcResult = await rpc.rpc('search_document_chunks', {
    target_user_id: userId,
    target_conversation_id: conversationId,
    query_embedding: queryEmbedding,
    match_count: 8,
    min_similarity: 0.2,
  });

  if (rpcResult.error) {
    console.error('[DocChunks] RPC error:', rpcResult.error.message);
    return [];
  }

  const rows = rpcResult.data as Array<{
    id: number;
    content: string;
    source_type: string;
    source_id: string | null;
    metadata: Record<string, unknown> | null;
    created_at: string;
    score: number;
  }> | null;

  if (!rows || rows.length === 0) {
    return [];
  }

  // ═══ 2. Build neighbor map: chunk_index ± 1 ═══
  const neededChunks = new Map<string, Set<number>>();
  for (const row of rows) {
    const meta = row.metadata ?? {};
    const fileName = String(meta.file_name || 'unknown');
    const chunkIndex = Number(meta.chunk_index ?? -1);
    if (chunkIndex < 0) continue;

    if (!neededChunks.has(fileName)) neededChunks.set(fileName, new Set());
    const indices = neededChunks.get(fileName)!;
    indices.add(chunkIndex);
    if (chunkIndex > 0) indices.add(chunkIndex - 1);
    indices.add(chunkIndex + 1);
  }

  // ═══ 3. Assemble: top hits (HOT) ═══
  const result: RetrievedResult[] = [];
  const seenIds = new Set<number>();

  for (const row of rows) {
    if (seenIds.has(row.id)) continue;
    seenIds.add(row.id);
    result.push({
      id: row.id,
      content: row.content,
      source_type: row.source_type,
      source_id: row.source_id,
      metadata: (row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata))
        ? row.metadata as Record<string, unknown>
        : {},
      created_at: row.created_at,
      score: row.score,
      temperature: 'hot',
    });
  }

  // ═══ 4. Fetch neighbor chunks (NO embedding column needed) ═══
  if (neededChunks.size > 0) {
    const { data: allDocRows } = await supabase
      .from('embeddings')
      .select('id, content, source_type, source_id, metadata, created_at')
      .eq('user_id', userId)
      .eq('source_type', 'document');

    if (allDocRows) {
      for (const row of allDocRows as Array<{
        id: number;
        content: string;
        source_type: string;
        source_id: string | null;
        metadata: Record<string, unknown> | null;
        created_at: string;
      }>) {
        if (seenIds.has(row.id)) continue;
        const meta = row.metadata ?? {};
        if (meta.conversation_id !== conversationId) continue;
        if (meta.is_active === false) continue;

        const fileName = String(meta.file_name || 'unknown');
        const chunkIndex = Number(meta.chunk_index ?? -1);
        const needed = neededChunks.get(fileName);

        if (needed && needed.has(chunkIndex)) {
          seenIds.add(row.id);
          result.push({
            id: row.id,
            content: row.content,
            source_type: row.source_type,
            source_id: row.source_id,
            metadata: (meta && typeof meta === 'object' && !Array.isArray(meta))
              ? meta as Record<string, unknown>
              : {},
            created_at: row.created_at,
            score: 0.5,
            temperature: 'warm',
          });
        }
      }
    }
  }

  // ═══ 5. Sort by file + chunk_index for reading order ═══
  result.sort((a, b) => {
    const fileA = String(a.metadata?.file_name || '');
    const fileB = String(b.metadata?.file_name || '');
    if (fileA !== fileB) return fileA.localeCompare(fileB);
    return (Number(a.metadata?.chunk_index) || 0) - (Number(b.metadata?.chunk_index) || 0);
  });

  console.log(`[DocChunks] Retrieved ${result.length} chunks (score: ${rows[0]?.score?.toFixed(3) ?? 'N/A'})`);

  return result;
}
// ═══════════════════════════════════════════════════════════
// Legacy-compatible wrapper
// ═══════════════════════════════════════════════════════════

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

function formatResultsAsString(results: RetrievedResult[], conversationId: string): string {
  const sections: string[] = [];
  const conversationMemories: string[] = [];
  const factMemories: string[] = [];
  const otherMemories: string[] = [];

  for (const r of results) {
    const timeAgo = formatTimeAgo(r.created_at);
    const isCurrentConv = r.metadata?.conversation_id === conversationId;

    if (r.source_type === 'fact' || r.source_type === 'document' || r.source_type === 'anti_memory') {
      const prefix = r.source_type === 'anti_memory' ? '⚠️ ' : '• ';
      factMemories.push(`${prefix}${r.content}`);
    } else if (isCurrentConv) {
      conversationMemories.push(`[${timeAgo}] ${r.content}`);
    } else {
      otherMemories.push(`[${r.source_type}, ${timeAgo}] ${r.content}`);
    }
  }

  if (conversationMemories.length > 0) {
    sections.push('Earlier in this conversation:\n' + conversationMemories.join('\n'));
  }
  if (factMemories.length > 0) {
    sections.push('Known facts about user:\n' + factMemories.join('\n'));
  }
  if (otherMemories.length > 0) {
    sections.push('From past conversations:\n' + otherMemories.join('\n'));
  }

  return sections.join('\n\n');
}

export async function retrieveMemoriesLegacy(
  userId: string,
  message: string,
  topK: number = 8,
  conversationId?: string
): Promise<string> {
  if (!conversationId) return '';

  const defaultClassification: ClassificationResult = {
    intent: 'question',
    complexity: 'medium',
    needsRAG: true,
    needsInternet: false,
    hasImageInput: false,
    needsImageGeneration: false,
    routeOverride: 'none',
    suggestedModel: 'auto',
    language: 'en',
    mainTopic: 'unknown',
    workingMemoryPhase: 'none',
    hasCodeMarkers: false,
    referencesDocument: false,
  };

  const result = await retrieveMemories({
    userId,
    conversationId,
    message,
    conversationContext: '',
    classification: defaultClassification,
    topK,
  });

  const allResults = [...result.documentChunks, ...result.hot, ...result.warm, ...result.cold];
  if (allResults.length === 0) return '';

  return formatResultsAsString(allResults, conversationId);
}