// ============================================================
// Structure-Aware Document Chunking — V4
// Replaces blind recursive chunking with structure-aware parsing
// Preserves code blocks, tables, lists as atomic units
// Zero LLM cost — uses header breadcrumbs as context prefix
// ============================================================

import { createServiceClient } from '@/lib/supabase/server';
import { generateEmbedding } from '@/lib/ai/embeddings';
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

/**
 * Parse a document into structural blocks.
 * Works for markdown, plain text, and extracted PDF text.
 */
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
    // Code block detection
    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        // End of code block
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
        // Start of code block
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

    // Heading detection
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      flushBlock();
      const level = headingMatch[1].length;
      const title = headingMatch[2].trim();

      // Update breadcrumb: remove anything at same or deeper level
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

    // Table detection (lines with | separators)
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

    // List detection
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

    // Empty line — flush current paragraph
    if (line.trim() === '') {
      if (currentBlock.length > 0) {
        flushBlock();
      }
      continue;
    }

    // Regular paragraph text
    currentBlock.push(line);
  }

  // Flush any remaining content
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

/**
 * Chunk structural blocks respecting atomic boundaries.
 * Code blocks and tables are never split.
 */
function chunkStructurally(blocks: StructuralBlock[], maxTokens = 400): Chunk[] {
  const chunks: Chunk[] = [];
  let currentBlocks: StructuralBlock[] = [];
  let currentTokens = 0;

  for (const block of blocks) {
    const blockTokens = estimateTokens(block.content);

    // Atomic blocks (code, table): always standalone
    if (block.type === 'code' || block.type === 'table') {
      if (currentBlocks.length > 0) {
        chunks.push(finalizeChunk(currentBlocks, chunks.length));
        currentBlocks = [];
        currentTokens = 0;
      }
      chunks.push(finalizeChunk([block], chunks.length));
      continue;
    }

    // Skip headings as standalone (they'll be captured in breadcrumbs)
    if (block.type === 'heading') {
      continue;
    }

    // If adding this block exceeds budget, close current chunk
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

  // Fill in total_chunks
  return chunks.map(c => ({
    ...c,
    metadata: { ...c.metadata, total_chunks: chunks.length },
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
      total_chunks: 0, // filled later
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
 * Process a document: parse into structural blocks, chunk, embed, and store.
 * Returns the document registry entry.
 */
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

    // Parse and chunk
    const blocks = parseDocument(content);
    const chunks = chunkStructurally(blocks);

    // Embed each chunk and store
    for (const chunk of chunks) {
      const embedding = await generateEmbedding(chunk.content);
      await supabase.from('embeddings').insert({
        user_id: userId,
        source_type: 'document',
        content: chunk.content.slice(0, 8000),
        embedding,
        metadata: {
          conversation_id: conversationId,
          file_name: fileName,
          file_type: fileType,
          is_active: true,
          ...chunk.metadata,
        },
      });
    }

    // Build document registry entry
    const keySections = blocks
      .filter(b => b.type === 'heading')
      .map(b => b.content.replace(/^#+\s*/, ''))
      .slice(0, 10);

    const summary = `${fileName} (${chunks.length} chunks, ${fileType}): ${keySections.slice(0, 3).join(', ') || 'document content'}`;

    // Update conversation document registry
    const { data: convo } = await supabase
      .from('conversations')
      .select('document_registry')
      .eq('id', conversationId)
      .single();

    const registry = (convo?.document_registry as unknown[] || []) as Array<Record<string, unknown>>;
    registry.push({
      filename: fileName,
      summary,
      chunk_count: chunks.length,
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
      chunk_count: chunks.length,
      key_sections: keySections,
    };
  } catch (error) {
    Sentry.captureException(error, {
      tags: { action: 'document_processing' },
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
