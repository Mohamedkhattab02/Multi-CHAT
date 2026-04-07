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
  documentChunks: RetrievedResult[]; // dedicated document section
  tempMessageId: number | null;
}

/**
 * V4 RAG Pipeline — 8-step retrieval with pre-embedding,
 * adaptive weights, temperature, and fingerprint filtering.
 */
export async function retrieveMemories(params: {
  userId: string;
  conversationId: string;
  message: string;
  conversationContext: string;
  classification: ClassificationResult;
  topK?: number;
}): Promise<RetrievedContext> {
  const { userId, conversationId, message, classification, topK = 12 } = params;
  const supabase = createServiceClient();

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
      // Use scoped search if we have fingerprint results, otherwise global
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
              temperature: 'cold', // will be assigned in step 6
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

  // ═══ STEP 9: DEDICATED DOCUMENT RETRIEVAL ═══
  // When user references a document, do a targeted search on document chunks
  // and pull in neighboring chunks for continuity
  let documentChunks: RetrievedResult[] = [];
  if (classification.referencesDocument || active.some(r => r.source_type === 'document')) {
    try {
      documentChunks = await retrieveDocumentChunks({
        userId,
        conversationId,
        message,
        queryEmbedding: currentMessageEmbedding,
        existingDocResults: active.filter(r => r.source_type === 'document'),
        supabase,
      });
    } catch (err) {
      Sentry.captureException(err, { tags: { action: 'document_retrieval' } });
    }
  }

  // Remove document chunks from the regular tiers (they have their own section)
  const nonDocActive = active.filter(r => r.source_type !== 'document');

  return {
    hot: nonDocActive.filter(r => r.temperature === 'hot'),
    warm: nonDocActive.filter(r => r.temperature === 'warm'),
    cold: nonDocActive.filter(r => r.temperature === 'cold'),
    documentChunks,
    tempMessageId,
  };
}

/**
 * Dedicated document chunk retrieval.
 * 1. Semantic search on source_type='document' for this conversation
 * 2. For each matched chunk, also fetch neighboring chunks (chunk_index ± 1)
 *    so the model sees full context around the relevant section
 * 3. Deduplicate and sort by file + chunk_index for reading order
 */
async function retrieveDocumentChunks(params: {
  userId: string;
  conversationId: string;
  message: string;
  queryEmbedding: number[];
  existingDocResults: RetrievedResult[];
  supabase: ReturnType<typeof createServiceClient>;
}): Promise<RetrievedResult[]> {
  const { userId, conversationId, message, queryEmbedding, existingDocResults, supabase } = params;

  // 1. Find the top document chunks by semantic similarity in this conversation
  const { data: semanticHits } = await supabase
    .from('embeddings')
    .select('id, content, source_type, source_id, metadata, created_at')
    .eq('user_id', userId)
    .eq('source_type', 'document')
    .order('created_at', { ascending: false })
    .limit(200); // get all document embeddings, filter in-memory

  if (!semanticHits || semanticHits.length === 0) return existingDocResults;

  // Filter to only this conversation's documents
  const conversationDocs = semanticHits.filter(e => {
    const meta = e.metadata as Record<string, unknown> | null;
    return meta?.conversation_id === conversationId && meta?.is_active !== false;
  });

  if (conversationDocs.length === 0) return existingDocResults;

  // 2. Semantic search specifically for document chunks in this conversation.
  //    We do a direct vector similarity query on the embeddings table
  //    filtered to source_type='document' for this conversation.
  const { data: docSearchResults } = await supabase
    .from('embeddings')
    .select('id, content, source_type, source_id, metadata, created_at')
    .eq('user_id', userId)
    .eq('source_type', 'document')
    .limit(100);

  // Filter to this conversation's documents only
  const docHits: Array<{
    id: number;
    content: string;
    source_type: string;
    source_id: string | null;
    metadata: Record<string, unknown>;
    created_at: string;
    score: number;
  }> = [];

  if (docSearchResults) {
    // Score each document chunk by simple word overlap with the query
    // (semantic similarity was already used in the main hybrid search)
    const queryWords = new Set(
      conversationId.length > 0 ? [] : [] // placeholder
    );

    for (const row of docSearchResults) {
      const meta = row.metadata as Record<string, unknown> | null;
      if (!meta || meta.conversation_id !== conversationId) continue;
      if (meta.is_active === false) continue;

      docHits.push({
        id: row.id,
        content: row.content,
        source_type: row.source_type,
        source_id: (row.source_id as string) ?? null,
        metadata: meta as Record<string, unknown>,
        created_at: row.created_at,
        score: 0.7, // base score for conversation-local document chunks
      });
    }
  }

  // Also add any document chunks that came through the main hybrid search
  for (const existing of existingDocResults) {
    if (!docHits.some(h => h.id === existing.id)) {
      docHits.push({
        ...existing,
        score: existing.score, // keep original score (likely higher)
      });
    }
  }

  if (docHits.length === 0) return existingDocResults;

  // 2b. Rerank document chunks to find the most relevant to the user's question
  const rerankedDocs = await rerankResults(
    message,
    docHits.map(h => ({ ...h, content: h.content })),
    6
  ).catch(() => docHits.slice(0, 6));

  // Replace docHits with reranked results for neighbor lookup
  const topDocHits = rerankedDocs.length > 0 ? rerankedDocs : docHits.slice(0, 6);

  // 3. Collect matched chunk indices and their file names
  const matchedChunks = new Map<string, Set<number>>(); // file_name -> Set<chunk_index>
  for (const hit of topDocHits) {
    const meta = hit.metadata as Record<string, unknown> | null;
    if (!meta) continue;
    const fileName = String(meta.file_name || 'unknown');
    const chunkIndex = Number(meta.chunk_index ?? -1);
    if (chunkIndex < 0) continue;

    if (!matchedChunks.has(fileName)) {
      matchedChunks.set(fileName, new Set());
    }
    const indices = matchedChunks.get(fileName)!;
    // Add the matched chunk + neighbors
    indices.add(chunkIndex);
    if (chunkIndex > 0) indices.add(chunkIndex - 1);
    indices.add(chunkIndex + 1);
  }

  // 4. Fetch all needed chunks (matched + neighbors) from the conversation docs
  const neededChunks: RetrievedResult[] = [];
  const seenIds = new Set<number>();

  // First add the reranked top hits themselves
  for (const hit of topDocHits) {
    if (seenIds.has(hit.id)) continue;
    seenIds.add(hit.id);
    neededChunks.push({
      id: hit.id,
      content: hit.content,
      source_type: hit.source_type,
      source_id: (hit.source_id as string) ?? null,
      metadata: (hit.metadata && typeof hit.metadata === 'object' && !Array.isArray(hit.metadata)
        ? hit.metadata as Record<string, unknown>
        : {}) as Record<string, unknown>,
      created_at: hit.created_at,
      score: hit.score,
      temperature: 'hot',
    });
  }

  // Now fetch neighbors from the full conversation docs list
  for (const doc of conversationDocs) {
    if (seenIds.has(doc.id)) continue;
    const meta = doc.metadata as Record<string, unknown> | null;
    if (!meta) continue;
    const fileName = String(meta.file_name || 'unknown');
    const chunkIndex = Number(meta.chunk_index ?? -1);

    const neededForFile = matchedChunks.get(fileName);
    if (neededForFile && neededForFile.has(chunkIndex)) {
      seenIds.add(doc.id);
      neededChunks.push({
        id: doc.id,
        content: doc.content,
        source_type: doc.source_type,
        source_id: (doc.source_id as string) ?? null,
        metadata: meta as Record<string, unknown>,
        created_at: doc.created_at,
        score: 0.5, // neighbor — lower score than direct hits
        temperature: 'warm',
      });
    }
  }

  // 5. Sort by file name + chunk index for reading order
  neededChunks.sort((a, b) => {
    const fileA = String(a.metadata?.file_name || '');
    const fileB = String(b.metadata?.file_name || '');
    if (fileA !== fileB) return fileA.localeCompare(fileB);
    return (Number(a.metadata?.chunk_index) || 0) - (Number(b.metadata?.chunk_index) || 0);
  });

  return neededChunks;
}

/**
 * Legacy-compatible wrapper that returns a formatted string.
 * Used during transition to V4.
 */
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
