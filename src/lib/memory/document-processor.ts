// ============================================================
// Structure-Aware Document Chunking — V4
// Replaces blind recursive chunking with structure-aware parsing
// Preserves code blocks, tables, lists as atomic units
// Zero LLM cost — uses header breadcrumbs as context prefix
// V4 fix: batch embedding + RPC insert (no PostgREST vector issues)
// ============================================================

import { createServiceClient } from '@/lib/supabase/server';
import { generateEmbeddingBatch } from '@/lib/ai/embeddings';
import { estimateTokens } from '@/lib/utils/tokens';
import * as Sentry from '@sentry/nextjs';

interface StructuralBlock {
  type: 'heading' | 'paragraph' | 'code' | 'table' | 'list' | 'other';
  level?: number;
  content: string;
  breadcrumb: string[];
}

interface Chunk {
  content: string;
  metadata: {
    section_type: string;
    breadcrumb: string;
    chunk_index: number;
    total_chunks: number;
  };
}

function parseDocument(text: string): StructuralBlock[] {
  const lines = text.split('\n');
  const blocks: StructuralBlock[] = [];
  const breadcrumb: string[] = [];
  let currentBlock: string[] = [];
  let currentType: StructuralBlock['type'] = 'paragraph';
  let inCodeBlock = false;
  let codeBlockContent: string[] = [];

  function flushBlock() {
    const content = currentBlock.join('\n').trim();
    if (content) {
      blocks.push({
        type: currentType,
        content,
        breadcrumb: [...breadcrumb],
      });
    }
    currentBlock = [];
    currentType = 'paragraph';
  }

  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        codeBlockContent.push(line);
        blocks.push({
          type: 'code',
          content: codeBlockContent.join('\n'),
          breadcrumb: [...breadcrumb],
        });
        codeBlockContent = [];
        inCodeBlock = false;
        continue;
      } else {
        flushBlock();
        inCodeBlock = true;
        codeBlockContent = [line];
        continue;
      }
    }

    if (inCodeBlock) {
      codeBlockContent.push(line);
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      flushBlock();
      const level = headingMatch[1].length;
      const title = headingMatch[2].trim();

      while (breadcrumb.length >= level) {
        breadcrumb.pop();
      }
      breadcrumb.push(title);

      blocks.push({
        type: 'heading',
        level,
        content: line,
        breadcrumb: [...breadcrumb],
      });
      continue;
    }

    if (/^\|.*\|/.test(line.trim())) {
      if (currentType !== 'table') {
        flushBlock();
        currentType = 'table';
      }
      currentBlock.push(line);
      continue;
    } else if (currentType === 'table') {
      flushBlock();
    }

    if (/^\s*[-*+]\s/.test(line) || /^\s*\d+[.)]\s/.test(line)) {
      if (currentType !== 'list') {
        flushBlock();
        currentType = 'list';
      }
      currentBlock.push(line);
      continue;
    } else if (currentType === 'list' && line.trim() === '') {
      flushBlock();
      continue;
    }

    if (line.trim() === '') {
      if (currentBlock.length > 0) {
        flushBlock();
      }
      continue;
    }

    currentBlock.push(line);
  }

  if (inCodeBlock && codeBlockContent.length > 0) {
    blocks.push({
      type: 'code',
      content: codeBlockContent.join('\n'),
      breadcrumb: [...breadcrumb],
    });
  }
  flushBlock();

  return blocks;
}

function chunkStructurally(blocks: StructuralBlock[], maxTokens = 400): Chunk[] {
  const chunks: Chunk[] = [];
  let currentBlocks: StructuralBlock[] = [];
  let currentTokens = 0;

  for (const block of blocks) {
    const blockTokens = estimateTokens(block.content);

    if (block.type === 'code' || block.type === 'table') {
      if (currentBlocks.length > 0) {
        chunks.push(finalizeChunk(currentBlocks, chunks.length));
        currentBlocks = [];
        currentTokens = 0;
      }
      chunks.push(finalizeChunk([block], chunks.length));
      continue;
    }

    if (block.type === 'heading') {
      continue;
    }

    if (currentTokens + blockTokens > maxTokens && currentBlocks.length > 0) {
      chunks.push(finalizeChunk(currentBlocks, chunks.length));
      currentBlocks = [];
      currentTokens = 0;
    }

    currentBlocks.push(block);
    currentTokens += blockTokens;
  }

  if (currentBlocks.length > 0) {
    chunks.push(finalizeChunk(currentBlocks, chunks.length));
  }

  const total = chunks.length;
  return chunks.map(c => ({
    ...c,
    metadata: { ...c.metadata, total_chunks: total },
  }));
}

function finalizeChunk(blocks: StructuralBlock[], index: number): Chunk {
  const breadcrumb = blocks[0]?.breadcrumb?.join(' > ') || '';
  const content = blocks.map(b => b.content).join('\n\n');
  const sectionType = dominantType(blocks);

  return {
    content: breadcrumb ? `[${breadcrumb}]\n${content}` : content,
    metadata: {
      section_type: sectionType,
      breadcrumb,
      chunk_index: index,
      total_chunks: 0,
    },
  };
}

function dominantType(blocks: StructuralBlock[]): string {
  const counts: Record<string, number> = {};
  for (const b of blocks) {
    counts[b.type] = (counts[b.type] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'paragraph';
}

/**
 * Bypasses the typed Supabase client for custom RPC functions
 * that aren't in the generated Database types.
 * No `any`, no `never`, no `@ts-expect-error`.
 */
type UntypedRpcClient = {
  rpc: (
    fn: string,
    params?: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

async function rpcInsertEmbeddings(
  supabase: ReturnType<typeof createServiceClient>,
  rows: Array<Record<string, unknown>>
): Promise<{ success: number; failed: number }> {
  const SUB_BATCH = 40;
  let success = 0;
  let failed = 0;
  const rpc = supabase as unknown as UntypedRpcClient;

  for (let i = 0; i < rows.length; i += SUB_BATCH) {
    const subBatch = rows.slice(i, i + SUB_BATCH);

    const result = await rpc.rpc('insert_document_embeddings', {
      batch_rows: subBatch,
    });

    if (result.error) {
      console.error(
        `[DocumentProcessor] RPC failed at row ${i}/${rows.length}: ${result.error.message}`
      );
      failed += subBatch.length;
      continue;
    }

    // result.data is unknown — safely extract with typeof guards
    const raw = result.data;
    if (raw != null && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>;
      if (typeof obj.success === 'number') success += obj.success;
      if (typeof obj.failed === 'number') failed += obj.failed;
    } else {
      failed += subBatch.length;
    }
  }

  return { success, failed };
}

export async function processDocument(params: {
  userId: string;
  conversationId: string;
  fileName: string;
  content: string;
  fileType: string;
}): Promise<{
  filename: string;
  summary: string;
  chunk_count: number;
  key_sections: string[];
}> {
  const { userId, conversationId, fileName, content, fileType } = params;

  try {
    const supabase = createServiceClient();

    const blocks = parseDocument(content);
    const chunks = chunkStructurally(blocks);

    if (chunks.length === 0) {
      return {
        filename: fileName,
        summary: `${fileName} (empty or could not be parsed)`,
        chunk_count: 0,
        key_sections: [],
      };
    }

    const chunkTexts = chunks.map(c => c.content.slice(0, 8000));
    const embeddings = await generateEmbeddingBatch(chunkTexts);

    const allZero = embeddings.length > 0 && embeddings.every(e => e.every(v => v === 0));
    if (allZero) {
      console.error('[DocumentProcessor] All embeddings are zero vectors');
      Sentry.captureMessage('Document embedding complete failure', {
        level: 'error',
        extra: { filename: fileName, chunk_count: chunks.length },
      });
      return {
        filename: fileName,
        summary: `${fileName} (embedding failed — no search available)`,
        chunk_count: 0,
        key_sections: [],
      };
    }

    const rpcRows: Array<Record<string, unknown>> = chunks.map((chunk, i) => ({
      user_id: userId,
      source_type: 'document',
      source_id: '',
      content: chunk.content.slice(0, 8000),
      embedding: embeddings[i],
      metadata: {
        conversation_id: conversationId,
        file_name: fileName,
        file_type: fileType,
        is_active: true,
        is_current_message: false,
        section_type: chunk.metadata.section_type,
        breadcrumb: chunk.metadata.breadcrumb,
        chunk_index: chunk.metadata.chunk_index,
        total_chunks: chunk.metadata.total_chunks,
      },
    }));

    const { success, failed } = await rpcInsertEmbeddings(supabase, rpcRows);

    if (failed > 0) {
      Sentry.captureMessage('Document partial insert failure', {
        level: 'warning',
        extra: { filename: fileName, total: chunks.length, success, failed },
      });
    }

    const keySections = blocks
      .filter(b => b.type === 'heading')
      .map(b => b.content.replace(/^#+\s*/, ''))
      .slice(0, 10);

    const summary = `${fileName} (${success} chunks, ${fileType}): ${keySections.slice(0, 3).join(', ') || 'document content'}`;

    const { data: convo } = await supabase
      .from('conversations')
      .select('document_registry')
      .eq('id', conversationId)
      .single();

    const registry = (convo?.document_registry as unknown[] || []) as Array<Record<string, unknown>>;
    registry.push({
      filename: fileName,
      summary,
      chunk_count: success,
      key_sections: keySections,
      uploaded_at: new Date().toISOString(),
    });

    await supabase
      .from('conversations')
      .update({ document_registry: JSON.parse(JSON.stringify(registry)) })
      .eq('id', conversationId);

    return {
      filename: fileName,
      summary,
      chunk_count: success,
      key_sections: keySections,
    };
  } catch (error) {
    Sentry.captureException(error, {
      tags: { action: 'document_processing' },
      extra: { filename: fileName },
    });
    console.error('[DocumentProcessor] Failed:', error);
    return {
      filename: fileName,
      summary: `${fileName} (processing failed)`,
      chunk_count: 0,
      key_sections: [],
    };
  }
}