// ============================================================
// Main SSE Streaming Chat Endpoint — V4 Orchestrator
// POST /api/chat
// Orchestrates all V4 layers:
//   Layer 0: Memory Invalidation
//   Layer 1: Classifier (Gemini 2.5 Flash)
//   Layer 2: RAG Pipeline (8-step)
//   Layer 3: Context Assembly (stable prefix + variable suffix)
//   Layer 4: Generation (streaming + caching)
//   Layer 5: Post-Processing (embed, summary, WM, anti-memory)
// ============================================================

import { NextRequest } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { classifyIntent, routeByComplexity } from '@/lib/ai/classifier';
import { detectAndHandleInvalidation } from '@/lib/memory/invalidation';
import { retrieveMemories, type RetrievedContext } from '@/lib/memory/rag-pipeline';
import { assembleContext } from '@/lib/memory/context-assembler';
import { processDocument } from '@/lib/memory/document-processor';
import { streamGPT } from '@/lib/ai/openai';
import { streamGemini } from '@/lib/ai/gemini';
import { streamGLM } from '@/lib/ai/glm';
import { generateImage } from '@/lib/ai/gemini-image';
import { generateRollingSummary, saveStructuredSummary, generateTitle, type StructuredSummary } from '@/lib/memory/rolling-summary';
import { storeMessageEmbedding, promoteTempEmbedding } from '@/lib/memory/embed-store';
import { extractMemories } from '@/lib/memory/extract-memories';
import { updateWorkingMemory, type WorkingMemory } from '@/lib/memory/working-memory';
import { detectAntiMemory } from '@/lib/memory/anti-memory';
import { updateConversationFingerprint } from '@/lib/memory/conversation-fingerprint';
import { ChatMessageSchema } from '@/lib/security/validate';
import { extractWithVision } from '@/lib/ai/vision-extract';
import * as Sentry from '@sentry/nextjs';
import { z } from 'zod';
import pdfParse from 'pdf-parse-new';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';

async function extractPdfText(base64Data: string): Promise<string> {
  const buffer = Buffer.from(base64Data, 'base64');

  // Suppress noisy pdf.js font/page warnings (TT: CALL empty stack, fetchStandardFontData, etc.)
  const originalWarn = console.warn;
  const originalInfo = console.info;
  const pdfNoisePattern = /TT:|getTextContent|fetchStandardFontData|standardFontDataUrl|page=\d+/;
  console.warn = (...args: unknown[]) => {
    const msg = String(args[0] || '');
    if (pdfNoisePattern.test(msg)) return;
    originalWarn.apply(console, args);
  };
  console.info = (...args: unknown[]) => {
    const msg = String(args[0] || '');
    if (pdfNoisePattern.test(msg)) return;
    originalInfo.apply(console, args);
  };

  try {
    const result = await pdfParse(buffer);
    return result.text.slice(0, 8000);
  } finally {
    console.warn = originalWarn;
    console.info = originalInfo;
  }
}

async function extractDocxText(base64Data: string): Promise<string> {
  const buffer = Buffer.from(base64Data, 'base64');
  const result = await mammoth.extractRawText({ buffer });
  return result.value.slice(0, 8000);
}

function extractSpreadsheetText(base64Data: string): string {
  const buffer = Buffer.from(base64Data, 'base64');
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const parts: string[] = [];
  for (const sheetName of workbook.SheetNames.slice(0, 5)) {
    const sheet = workbook.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(sheet);
    parts.push(`[Sheet: ${sheetName}]\n${csv}`);
  }
  return parts.join('\n\n').slice(0, 8000);
}

async function extractPptxText(base64Data: string): Promise<string> {
  const buffer = Buffer.from(base64Data, 'base64');
  const zip = await JSZip.loadAsync(buffer);
  const parts: string[] = [];

  // PPTX slides are stored as ppt/slides/slide1.xml, slide2.xml, etc.
  const slideFiles = Object.keys(zip.files)
    .filter(name => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => {
      const numA = parseInt(a.match(/slide(\d+)/)?.[1] || '0');
      const numB = parseInt(b.match(/slide(\d+)/)?.[1] || '0');
      return numA - numB;
    });

  for (const slideName of slideFiles.slice(0, 50)) {
    const xml = await zip.files[slideName].async('text');
    // Extract text from <a:t> tags (DrawingML text runs)
    const texts: string[] = [];
    const regex = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g;
    let match;
    while ((match = regex.exec(xml)) !== null) {
      const text = match[1].trim();
      if (text) texts.push(text);
    }
    if (texts.length > 0) {
      const slideNum = slideName.match(/slide(\d+)/)?.[1] || '?';
      parts.push(`[Slide ${slideNum}]\n${texts.join(' ')}`);
    }
  }

  return parts.join('\n\n').slice(0, 8000);
}

async function uploadToSupabaseStorage(
  userId: string,
  fileName: string,
  base64Data: string,
  mimeType: string
): Promise<string | null> {
  try {
    // Use service client to bypass RLS for storage uploads
    const serviceClient = createServiceClient();
    const buffer = Buffer.from(base64Data, 'base64');
    const filePath = `${userId}/${Date.now()}_${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

    const { error } = await serviceClient.storage
      .from('attachments')
      .upload(filePath, buffer, {
        contentType: mimeType,
        upsert: false,
      });

    if (error) {
      console.error('[Storage Upload]', error.message);
      Sentry.captureException(error, { tags: { action: 'storage_upload' } });
      return null;
    }

    const { data: urlData } = serviceClient.storage
      .from('attachments')
      .getPublicUrl(filePath);

    return urlData.publicUrl;
  } catch (err) {
    console.error('[Storage Upload] Unexpected error:', err);
    Sentry.captureException(err, { tags: { action: 'storage_upload' } });
    return null;
  }
}

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  // ═══ SECURITY: Input Validation (Zod) ═══
  let body;
  try {
    const raw = await req.json();
    body = ChatMessageSchema.parse(raw);
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('[Zod Validation]', JSON.stringify(error.issues, null, 2));
      return new Response(
        JSON.stringify({ error: 'Invalid input', details: error.issues }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    console.error('[Chat API] Parse error:', error);
    return new Response('Bad request', { status: 400 });
  }

  const { conversationId, model, attachments } = body;
  const message = body.message || (attachments?.length ? 'Analyze the attached file' : '');
  if (!message && !attachments?.length) {
    return new Response(
      JSON.stringify({ error: 'Message or attachment required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }
  const supabase = await createClient();

  // Get authenticated user (retry once on network timeout)
  let user = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { data } = await supabase.auth.getUser();
      user = data.user;
      break;
    } catch (err) {
      const isTimeout = err instanceof Error &&
        (err.message.includes('fetch failed') || err.message.includes('ConnectTimeout') || err.message.includes('ENOTFOUND'));
      if (isTimeout && attempt === 0) {
        console.warn('[Auth] Supabase timeout, retrying...');
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
      console.error('[Auth] Failed:', err);
      break;
    }
  }
  if (!user) return new Response('Unauthorized', { status: 401 });

  // ═══ SECURITY: Daily message limit ═══
  const { data: userProfile } = await supabase
    .from('users')
    .select('*')
    .eq('id', user.id)
    .single();

  if (userProfile && userProfile.messages_today >= userProfile.daily_message_limit) {
    return new Response(
      JSON.stringify({ error: 'Daily message limit reached' }),
      { status: 429, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Increment message count
  await supabase
    .from('users')
    .update({
      messages_today: (userProfile?.messages_today || 0) + 1,
      last_reset_date: new Date().toISOString().split('T')[0],
    })
    .eq('id', user.id);

  // ═══ LAYER 0: MEMORY INVALIDATION ═══
  if (conversationId) {
    detectAndHandleInvalidation(user.id, conversationId, message)
      .catch(err => Sentry.captureException(err, { tags: { action: 'invalidation' } }));
  }

  // ═══ LAYER 1: INPUT PROCESSING + SMART ROUTING ═���═
  const hasImageAttachment = attachments?.some((a) =>
    a.type?.startsWith('image')
  );

  // Extract text content from attachments + upload to Supabase Storage
  let enrichedMessage = message;
  type DocProcessResult = { filename: string; summary: string; chunk_count: number; key_sections: string[] };
  const documentProcessingPromises: Promise<DocProcessResult>[] = [];
  // Store uploaded file URLs to save in message attachments (instead of base64)
  const processedAttachments: Array<{ type: string; name: string; url?: string; size?: number }> = [];

  if (attachments?.length) {
    const textParts: string[] = [];
    for (const att of attachments) {
      if (!att.data) continue;

      // Upload file to Supabase Storage
      const fileUrl = await uploadToSupabaseStorage(user.id, att.name || 'file', att.data, att.type);
      processedAttachments.push({
        type: att.type,
        name: att.name || 'file',
        url: fileUrl || undefined,
        size: att.size,
      });

      // ── Extract content: Vision-first for PDFs, fallback to text extraction ──
      if (att.type === 'application/pdf') {
        try {
          // PRIMARY: Gemini Vision — sees text, images, diagrams, tables visually
          const vision = await extractWithVision(att.data, att.type, att.name || 'document.pdf');
          let extractedText = vision.text;

          // FALLBACK: if Vision returned empty/too short, use traditional text extraction
          if (!extractedText || extractedText.trim().length < 50) {
            console.log(`[Extract] Vision returned little content for ${att.name}, falling back to pdf-parse`);
            const fallbackText = await extractPdfText(att.data);
            if (fallbackText.trim().length > extractedText.trim().length) {
              extractedText = fallbackText;
            }
          }

          if (extractedText.trim()) {
            textParts.push(`[Attached PDF: ${att.name}]\n${extractedText}`);
            if (conversationId) {
              documentProcessingPromises.push(
                processDocument({
                  userId: user.id,
                  conversationId,
                  fileName: att.name || 'document.pdf',
                  content: extractedText,
                  fileType: 'pdf',
                })
              );
            }
          }
        } catch (err) {
          Sentry.captureException(err, { tags: { action: 'pdf_extract' } });
          textParts.push(`[Attached PDF: ${att.name} — could not extract text]`);
        }
      } else if (
        att.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        att.type === 'application/msword'
      ) {
        try {
          const extractedText = await extractDocxText(att.data);
          if (extractedText.trim()) {
            textParts.push(`[Attached Document: ${att.name}]\n${extractedText}`);
            if (conversationId) {
              documentProcessingPromises.push(
                processDocument({
                  userId: user.id,
                  conversationId,
                  fileName: att.name || 'document.docx',
                  content: extractedText,
                  fileType: 'docx',
                })
              );
            }
          }
        } catch (err) {
          Sentry.captureException(err, { tags: { action: 'docx_extract' } });
          textParts.push(`[Attached Document: ${att.name} — could not extract text]`);
        }
      } else if (
        att.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
        att.type === 'application/vnd.ms-excel' ||
        att.type === 'text/csv'
      ) {
        try {
          let sheetText: string;
          if (att.type === 'text/csv') {
            sheetText = Buffer.from(att.data, 'base64').toString('utf-8').slice(0, 8000);
          } else {
            sheetText = extractSpreadsheetText(att.data);
          }
          if (sheetText.trim()) {
            textParts.push(`[Attached Spreadsheet: ${att.name}]\n${sheetText}`);
            if (conversationId) {
              documentProcessingPromises.push(
                processDocument({
                  userId: user.id,
                  conversationId,
                  fileName: att.name || 'spreadsheet.xlsx',
                  content: sheetText,
                  fileType: att.type,
                })
              );
            }
          }
        } catch (err) {
          Sentry.captureException(err, { tags: { action: 'spreadsheet_extract' } });
          textParts.push(`[Attached Spreadsheet: ${att.name} — could not extract data]`);
        }
      } else if (att.type.startsWith('text/') || att.type === 'application/json' || att.type === 'application/xml') {
        try {
          const textContent = Buffer.from(att.data, 'base64').toString('utf-8');
          textParts.push(`[Attached file: ${att.name}]\n${textContent.slice(0, 8000)}`);
          if (conversationId) {
            documentProcessingPromises.push(
              processDocument({
                userId: user.id,
                conversationId,
                fileName: att.name || 'file.txt',
                content: textContent,
                fileType: att.type,
              })
            );
          }
        } catch {
          textParts.push(`[Attached file: ${att.name} — could not read]`);
        }
      } else if (
        att.type === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
        att.type === 'application/vnd.ms-powerpoint'
      ) {
        try {
          const extractedText = await extractPptxText(att.data);
          if (extractedText.trim()) {
            textParts.push(`[Attached Presentation: ${att.name}]\n${extractedText}`);
            if (conversationId) {
              documentProcessingPromises.push(
                processDocument({
                  userId: user.id,
                  conversationId,
                  fileName: att.name || 'presentation.pptx',
                  content: extractedText,
                  fileType: 'pptx',
                })
              );
            }
          } else {
            textParts.push(`[Attached Presentation: ${att.name} — no text content found]`);
          }
        } catch (err) {
          Sentry.captureException(err, { tags: { action: 'pptx_extract' } });
          textParts.push(`[Attached Presentation: ${att.name} — could not extract text]`);
        }
      } else if (!att.type.startsWith('image/')) {
        // Catch-all: try to read as UTF-8 text for unknown file types
        try {
          const rawText = Buffer.from(att.data, 'base64').toString('utf-8');
          const nonPrintableRatio = (rawText.match(/[\x00-\x08\x0E-\x1F]/g) || []).length / rawText.length;
          if (nonPrintableRatio < 0.1 && rawText.trim().length > 0) {
            textParts.push(`[Attached file: ${att.name}]\n${rawText.slice(0, 8000)}`);
            if (conversationId) {
              documentProcessingPromises.push(
                processDocument({
                  userId: user.id,
                  conversationId,
                  fileName: att.name || 'file',
                  content: rawText,
                  fileType: att.type,
                })
              );
            }
          } else {
            textParts.push(`[Attached file: ${att.name} — binary file, text extraction not supported]`);
          }
        } catch {
          textParts.push(`[Attached file: ${att.name}]`);
        }
      }
    }
    if (textParts.length) {
      enrichedMessage = `${message}\n\n---\n${textParts.join('\n\n')}`;
    }
  }

  // CRITICAL: Await document processing BEFORE RAG runs,
  // so that document chunks exist in the DB when RAG queries them.
  // Run classification in parallel with document processing to save time.
  const [docResults, rawIntent] = await Promise.all([
    documentProcessingPromises.length > 0
      ? Promise.allSettled(documentProcessingPromises).then(results =>
          results
            .filter((r): r is PromiseFulfilledResult<DocProcessResult> => r.status === 'fulfilled')
            .map(r => r.value)
        )
      : Promise.resolve([] as DocProcessResult[]),
    classifyIntent(enrichedMessage, hasImageAttachment),
  ]);

  // ═══ GUARD: Only allow image routing when actual image files are attached ═══
  // PDFs with drawings/illustrations must NOT be routed to the image model
  const intent = { ...rawIntent };
  if (!hasImageAttachment) {
    intent.hasImageInput = false;
    // Only reset image routing for image ANALYSIS (not generation)
    if (intent.routeOverride === 'gemini-3.1-flash-image' && !intent.needsImageGeneration) {
      intent.routeOverride = 'none';
    }
    if (intent.intent === 'image_analysis') {
      intent.intent = 'analysis';
    }
    // Only allow needsImageGeneration if user explicitly asked to generate an image
    // (not just because a document mentions images/drawings)
    const IMAGE_GEN_RE = /(צור תמונה|תייצר.*תמונה|תייצר.*צמונה|תעשה.*תמונה|תכין.*תמונה|צייר|ציור|תמונה של|generate image|create image|draw me|draw a|paint|illustrate|make a picture|make an image|design an image)/i;
    if (intent.needsImageGeneration && !IMAGE_GEN_RE.test(message)) {
      intent.needsImageGeneration = false;
      // Now also reset routeOverride since we determined it's not actually image gen
      if (intent.routeOverride === 'gemini-3.1-flash-image') {
        intent.routeOverride = 'none';
      }
    }
  }

  // Log document processing results
  if (docResults.length > 0) {
    const totalChunks = docResults.reduce((sum, d) => sum + d.chunk_count, 0);
    console.log(`[DocProcess] Processed ${docResults.length} documents, ${totalChunks} total chunks`);
  }

  // ═══ SPECIAL ROUTE: Image Generation ═══
  if (intent.needsImageGeneration) {
    try {
      const imageResult = await generateImage(message);

      if (conversationId) {
        await supabase.from('messages').insert({
          conversation_id: conversationId,
          role: 'user',
          content: message,
          model: 'gemini-3.1-flash-image',
        });
        await supabase.from('messages').insert({
          conversation_id: conversationId,
          role: 'assistant',
          content: imageResult.revisedPrompt,
          model: 'gemini-3.1-flash-image',
          attachments: [
            {
              type: imageResult.mimeType,
              data: imageResult.imageBase64,
              name: 'generated-image.png',
            },
          ],
        });
      }

      return new Response(
        JSON.stringify({
          type: 'image',
          image: imageResult.imageBase64,
          mimeType: imageResult.mimeType,
          text: imageResult.revisedPrompt,
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[ImageGen] Failed after retries: ${errMsg}`);
      Sentry.captureException(error, { tags: { action: 'image_generation' } });

      const isSafetyBlock = errMsg.toLowerCase().includes('safety') || errMsg.toLowerCase().includes('blocked');
      return new Response(
        JSON.stringify({
          error: isSafetyBlock
            ? 'Image generation was blocked by safety filters. Try rephrasing your request.'
            : `Image generation failed: ${errMsg}`,
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  // Determine actual model
  let actualModel: string;
  if (intent.routeOverride !== 'none') {
    actualModel = intent.routeOverride;
  } else {
    actualModel = routeByComplexity(model, intent.complexity);
  }

  // ═══ LOAD CONVERSATION DATA FIRST (needed to decide RAG) ═══
  let conversation = null;
  let recentHistory: Array<{ role: string; content: string }> = [];
  let totalMessageCount = 0;
  let workingMemory: WorkingMemory | null = null;
  let structuredSummary: StructuredSummary | null = null;
  let documentRegistry: Array<{ filename: string; summary: string }> = [];

  if (conversationId) {
    const { data: conv } = await supabase
      .from('conversations')
      .select('id, user_id, title, model, summary, system_prompt, topic, message_count, is_pinned, folder_id, created_at, updated_at, working_memory, document_registry, structured_summary, gemini_cache_name, key_entities, key_topics')
      .eq('id', conversationId)
      .single();
    conversation = conv;
    totalMessageCount = conv?.message_count || 0;

    // Extract V4 fields
    workingMemory = conv?.working_memory as unknown as WorkingMemory | null;
    structuredSummary = conv?.structured_summary as unknown as StructuredSummary | null;
    documentRegistry = (conv?.document_registry as unknown as Array<{ filename: string; summary: string }>) || [];

    // Fetch recent messages (adaptive window applied in assembler)
    const { data: msgs } = await supabase
      .from('messages')
      .select('role, content, content_blocks')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(10);
    recentHistory = (msgs || []).reverse();

    // Save user message to DB (with Storage URLs instead of base64)
    await supabase.from('messages').insert({
      conversation_id: conversationId,
      role: 'user',
      content: message,
      model: actualModel,
      attachments: processedAttachments.length > 0 ? processedAttachments : [],
    });
  }

  // ═══ LAYER 2: MEMORY RETRIEVAL (RAG) — V4 8-step pipeline ═══
  // If documents were just processed, refresh documentRegistry from DB
  // (on first upload, the registry loaded earlier was empty)
  if (docResults.length > 0 && conversationId) {
    const { data: refreshedConv } = await supabase
      .from('conversations')
      .select('document_registry')
      .eq('id', conversationId)
      .single();
    if (refreshedConv?.document_registry) {
      documentRegistry = (refreshedConv.document_registry as unknown as Array<{ filename: string; summary: string }>) || [];
    }
  }

  // Run RAG when classifier says so, OR when documents exist AND user references them
  // Don't force RAG for unrelated general questions just because documents exist
  const hasDocuments = documentRegistry.length > 0 || docResults.some(d => d.chunk_count > 0);
  const shouldRunRAG = (intent.needsRAG || (hasDocuments && intent.referencesDocument)) && !!conversationId;

  let ragContext: RetrievedContext | null = null;
  if (shouldRunRAG && conversationId) {
    try {
      const conversationContext = recentHistory
        .slice(-3)
        .map(m => `${m.role}: ${m.content.slice(0, 200)}`)
        .join('\n');

      // If conversation has documents, force the classifier hints
      // so the RAG pipeline runs document retrieval
      const ragClassification = hasDocuments
        ? { ...intent, referencesDocument: true, needsRAG: true }
        : intent;

      ragContext = await retrieveMemories({
        userId: user.id,
        conversationId,
        message,
        conversationContext,
        classification: ragClassification,
      });
    } catch (err) {
      Sentry.captureException(err, { tags: { action: 'rag_retrieval' } });
    }
  }

  // Ensure ragContext includes the latest documentRegistry
  // (important on first upload when ragContext may be null or have empty registry)
  if (ragContext && documentRegistry.length > 0 && ragContext.documentRegistry.length === 0) {
    ragContext.documentRegistry = documentRegistry;
  }

  const { systemPrompt, messages: assembledMessages } = assembleContext({
    model: actualModel,
    userProfile: userProfile ? {
      name: userProfile.name,
      language: userProfile.language,
      expertise: userProfile.expertise,
    } : null,
    ragContext,
    messages: [...recentHistory, { role: 'user', content: enrichedMessage }],
    rollingSummary: conversation?.summary,
    structuredSummary,
    workingMemory,
    classification: intent,
    language: intent.language,
  });

  // ═══ LAYER 4: GENERATION (STREAMING) with AbortController ═══
  const encoder = new TextEncoder();
  const abortController = new AbortController();
  req.signal.addEventListener('abort', () => abortController.abort());

  const stream = new ReadableStream({
    async start(controller) {
      try {
        let generator;
        switch (actualModel) {
          case 'gpt-5.1':
          case 'gpt-5-mini':
            generator = streamGPT({
              systemPrompt,
              messages: assembledMessages,
              model: actualModel,
              userId: user.id,
              conversationId: conversationId || undefined,
              signal: abortController.signal,
            });
            break;
          case 'gemini-3.1-pro':
          case 'gemini-3-flash':
          case 'gemini-3.1-flash-image': {
            // gemini-3.1-flash-image is only for image generation (handled above);
            // if we reach here, fall back to gemini-3-flash for normal streaming
            if (actualModel === 'gemini-3.1-flash-image') {
              actualModel = 'gemini-3-flash';
            }
            // Extract image attachments for Gemini vision
            const imageAttachments = (attachments || [])
              .filter(a => a.type?.startsWith('image') && a.data)
              .map(a => ({ type: a.type, data: a.data!, name: a.name }));

            generator = streamGemini({
              systemPrompt,
              messages: assembledMessages,
              model: actualModel as 'gemini-3.1-pro' | 'gemini-3-flash',
              enableSearch: intent.needsInternet,
              userId: user.id,
              conversationId: conversationId || undefined,
              signal: abortController.signal,
              imageAttachments,
              existingCacheName: conversation?.gemini_cache_name || null,
            });
            break;
          }
          case 'glm-4.7':
          case 'glm-4.6':
            generator = streamGLM({
              systemPrompt,
              messages: assembledMessages,
              model: actualModel as 'glm-4.7' | 'glm-4.6',
              userId: user.id,
              conversationId: conversationId || undefined,
              signal: abortController.signal,
            });
            break;
          default:
            throw new Error(`Unknown model: ${actualModel}`);
        }

        // Heartbeat to prevent timeout
        const heartbeatInterval = setInterval(() => {
          if (!abortController.signal.aborted) {
            controller.enqueue(encoder.encode(': heartbeat\n\n'));
          }
        }, 15000);

        // Send routing info
        if (intent.routeOverride !== 'none') {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ routeOverride: actualModel })}\n\n`
            )
          );
        }

        for await (const event of generator) {
          if (abortController.signal.aborted) break;

          if (event.type === 'text') {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ text: event.text })}\n\n`
              )
            );
          } else if (event.type === 'error') {
            console.error('[Model Error]', event.text);
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ error: event.text })}\n\n`
              )
            );
          } else if (event.type === 'done') {
            clearInterval(heartbeatInterval);

            // ═══ LAYER 5: POST-PROCESSING (V4) ═══
            if (conversationId) {
              // Save assistant message
              await supabase.from('messages').insert({
                conversation_id: conversationId,
                role: 'assistant',
                content: event.fullText || '',
                content_blocks: (event.contentBlocks ?? null) as import('@/lib/supabase/types').Json,
                model: actualModel,
              });

              const messageCount = totalMessageCount + 2;

              // 1. Promote pre-embed from RAG step
              if (ragContext?.tempMessageId) {
                promoteTempEmbedding(ragContext.tempMessageId)
                  .catch(err => Sentry.captureException(err));
              }

              // 2. Embed assistant response
              if (event.fullText) {
                storeMessageEmbedding(user.id, event.fullText, conversationId, 'assistant')
                  .catch(err => Sentry.captureException(err, { tags: { action: 'embed_assistant' } }));
              }

              // 3. Usage logging
              if (event.usage) {
                supabase
                  .from('usage_logs')
                  .insert({
                    user_id: user.id,
                    model: actualModel,
                    input_tokens: event.usage.inputTokens,
                    output_tokens: event.usage.outputTokens,
                    cost_usd: event.usage.cost,
                    endpoint: 'chat',
                  })
                  .then(() => {});
              }

              // 4. Rolling summary (V4: incremental patching)
              // First summary at message 6, then every 8 messages
              if (messageCount >= 6 && (messageCount === 6 || messageCount % 8 === 0)) {
                generateRollingSummary(
                  conversation?.summary,
                  structuredSummary,
                  recentHistory.slice(-5),
                  message,
                  event.fullText || ''
                )
                  .then(async ({ text, structured }) => {
                    await saveStructuredSummary(conversationId, text, structured);
                  })
                  .catch(err => Sentry.captureException(err));
              }

              // 5. Working memory update every 3 messages or phase change
              if (messageCount % 3 === 0 || intent.workingMemoryPhase !== 'none') {
                updateWorkingMemory(
                  conversationId,
                  [...recentHistory.slice(-5), { role: 'user', content: message }, { role: 'assistant', content: event.fullText || '' }],
                  intent
                ).catch(err => Sentry.captureException(err));
              }

              // 6. Extract memories every 5 messages (with V4 dedup)
              if (messageCount > 0 && messageCount % 5 === 0 && event.fullText) {
                extractMemories(user.id, message, event.fullText, conversationId)
                  .catch(err => Sentry.captureException(err, { tags: { action: 'extract_memories' } }));
              }

              // 7. Anti-memory detection
              if (event.fullText) {
                const lastAssistantMsg = recentHistory
                  .filter(m => m.role === 'assistant')
                  .pop();
                if (lastAssistantMsg) {
                  detectAntiMemory(message, lastAssistantMsg.content, user.id, conversationId)
                    .catch(err => Sentry.captureException(err));
                }
              }

              // 8. Conversation fingerprint update every 20 messages
              if (messageCount > 0 && messageCount % 20 === 0) {
                updateConversationFingerprint(conversationId)
                  .catch(err => Sentry.captureException(err));
              }

              // Auto-generate title for new conversations and send it back via SSE
              if (totalMessageCount === 0) {
                generateTitle(message, event.fullText || '')
                  .then(async (title) => {
                    await supabase
                      .from('conversations')
                      .update({
                        title,
                        topic: intent.mainTopic,
                        model: actualModel,
                      })
                      .eq('id', conversationId);
                    // Send title update to client
                    try {
                      controller.enqueue(
                        encoder.encode(
                          `data: ${JSON.stringify({ titleUpdate: title })}\n\n`
                        )
                      );
                    } catch {
                      // Controller may be closed already
                    }
                  })
                  .catch(err => Sentry.captureException(err));
              }
            }

            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ done: true, usage: event.usage })}\n\n`
              )
            );
          }
        }

        clearInterval(heartbeatInterval);
      } catch (error) {
        console.error('[Chat Stream Error]', error instanceof Error ? error.stack : error);
        Sentry.captureException(error, {
          tags: { model: actualModel, action: 'stream' },
          extra: { conversationId, messageLength: message.length },
        });
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ error: 'An error occurred. Please try again.' })}\n\n`
          )
        );
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}