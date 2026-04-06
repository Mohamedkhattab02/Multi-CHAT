import pdf from 'pdf-parse';
import mammoth from 'mammoth';
import { generateEmbedding } from '@/lib/ai/embeddings';
import { generateGeminiFlash } from '@/lib/ai/gemini-flash';

interface StructuredChunk {
  content: string;
  headers: string[];
  chunkIndex: number;
  totalChunks: number;
  sectionType: 'heading' | 'paragraph' | 'code' | 'table' | 'list' | 'mixed';
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

function structureAwareChunk(text: string, maxTokens: number = 400, overlapTokens: number = 50): StructuredChunk[] {
  const lines = text.split('\n');
  const chunks: StructuredChunk[] = [];
  let currentLines: string[] = [];
  let currentHeaders: string[] = [];
  let currentTokens = 0;
  let sectionTypes = new Set<string>();

  function flush() {
    if (currentLines.length === 0) return;
    const content = currentLines.join('\n').trim();
    if (!content) return;
    let sectionType: StructuredChunk['sectionType'] = 'mixed';
    if (sectionTypes.size === 1) {
      const t = [...sectionTypes][0];
      if (['heading','paragraph','code','table','list'].includes(t)) sectionType = t as any;
    }
    chunks.push({ content, headers: [...currentHeaders], chunkIndex: chunks.length, totalChunks: 0, sectionType });
    currentLines = []; currentTokens = 0; sectionTypes.clear();
  }

  for (const line of lines) {
    const lineTokens = estimateTokens(line);
    const headingMatch = line.match(/^(#{1,6}\s+.+)|([A-Z][A-Z\s]{3,})|(\d+\.\s+[A-Z].+)$/);
    
    if (headingMatch) {
      if (currentTokens + lineTokens > maxTokens * 0.8) flush();
      const level = (line.match(/^(#{1,6})/)?.[1]?.length || 1);
      currentHeaders = currentHeaders.slice(0, level - 1);
      currentHeaders.push(line.replace(/^#+\s*/, '').trim());
      sectionTypes.add('heading');
    }

    if (line.trim().startsWith('```')) sectionTypes.add('code');
    else if (line.match(/^\s*[-*+]\s/)) sectionTypes.add('list');
    else if (line.match(/^\|.*\|$/)) sectionTypes.add('table');
    else if (line.trim().length > 0) sectionTypes.add('paragraph');

    if (currentTokens + lineTokens > maxTokens) {
      const splitAt = Math.floor(currentLines.length * 0.7);
      const kept = currentLines.splice(0, splitAt);
      chunks.push({ content: kept.join('\n').trim(), headers: [...currentHeaders], chunkIndex: chunks.length, totalChunks: 0, sectionType: 'mixed' });
      if (kept.length >= 2) {
        currentLines = [...kept.slice(-2), line];
        currentTokens = estimateTokens(kept.slice(-2).join('\n')) + lineTokens;
      } else {
        currentLines = [line]; currentTokens = lineTokens;
      }
      sectionTypes.clear(); continue;
    }
    currentLines.push(line); currentTokens += lineTokens;
  }
  flush();
  for (const c of chunks) c.totalChunks = chunks.length;
  return chunks;
}

export async function processUploadedDocument(
  userId: string,
  conversationId: string,
  file: { url: string; name: string; type: string },
  supabase: any
): Promise<{ chunkCount: number; summary: string }> {
  const response = await fetch(file.url);
  const buffer = await response.arrayBuffer();

  let text = '';
  if (file.type === 'application/pdf') {
    const data = await pdf(Buffer.from(buffer));
    text = data.text;
  } else if (file.name.endsWith('.docx') || file.type.includes('wordprocessingml')) {
    const result = await mammoth.extractRawText({ buffer: Buffer.from(buffer) });
    text = result.value;
  } else {
    text = new TextDecoder().decode(buffer);
  }

  if (text.length < 50) return { chunkCount: 0, summary: 'Document too short' };

  const chunks = structureAwareChunk(text);

  for (const chunk of chunks) {
    const prefix = chunk.headers.length > 0 
      ? `[Document: ${file.name}, Section: ${chunk.headers.join(' > ')}]` 
      : `[Document: ${file.name}, Part ${chunk.chunkIndex + 1}/${chunk.totalChunks}]`;
    const enrichedContent = `${prefix}\n${chunk.content}`;
    
    const embedding = await generateEmbedding(enrichedContent);
    await supabase.from('embeddings').insert({
      user_id: userId, source_type: 'document', content: enrichedContent, embedding,
      metadata: {
        conversation_id: conversationId, filename: file.name,
        chunk_index: chunk.chunkIndex, total_chunks: chunk.totalChunks,
        section_type: chunk.sectionType, headers: chunk.headers, is_active: true,
      },
    });
  }

  // Generate quick summary for registry
  const summary = await generateGeminiFlash(`Summarize in 1-2 sentences: ${text.slice(0, 2000)}`, 100);
  
  const { data: conv } = await supabase.from('conversations').select('document_registry').eq('id', conversationId).single();
  const registry = conv?.document_registry || [];
  registry.push({ filename: file.name, uploaded_at: new Date().toISOString(), summary: summary.slice(0, 200), chunk_count: chunks.length });
  
  await supabase.from('conversations').update({ document_registry: registry }).eq('id', conversationId);

  return { chunkCount: chunks.length, summary: summary.slice(0, 200) };
}