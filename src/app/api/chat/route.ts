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
//
// V5 PERF: Stream opens immediately after auth. Heavy work
//          (classification, RAG, doc processing) runs inside
//          the stream with real-time status events so the client
//          sees progress instantly instead of a blank screen.
//
// NOTE: File upload + text extraction is handled by /api/upload.
// This route receives pre-extracted text via attachments[].extractedText.
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
import { extractTextFromFile } from '@/lib/utils/extract-text';
import * as Sentry from '@sentry/nextjs';
import { z } from 'zod';

/**
 * Download file from Supabase Storage and return base64 data.
 * Only used for image attachments that need inline data for Gemini vision.
 */
async function downloadFromStorage(storagePath: string): Promise<string | null> {
  try {
    const serviceClient = createServiceClient();
    const { data, error } = await serviceClient.storage
      .from('attachments')
      .download(storagePath);

    if (error || !data) {
      console.error('[Storage Download]', error?.message);
      return null;
    }

    const arrayBuffer = await data.arrayBuffer();
    return Buffer.from(arrayBuffer).toString('base64');
  } catch (err) {
    console.error('[Storage Download] Unexpected error:', err);
    Sentry.captureException(err, { tags: { action: 'storage_download' } });
    return null;
  }
}

export const runtime = 'nodejs';
export const maxDuration = 120;

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

  // ═══ SPECIAL ROUTE: Image Generation (detect early, before streaming) ═══
  const hasImageAttachment = attachments?.some((a) => a.type?.startsWith('image'));
  const IMAGE_GEN_PATTERNS_EARLY = /\b(צור תמונה|generate image|create image|draw|paint|illustrate|ציור|תמונה של|make a picture|design)\b/i;
  const isLikelyImageGen = !hasImageAttachment && IMAGE_GEN_PATTERNS_EARLY.test(message);

  if (isLikelyImageGen) {
    // Increment message count
    await supabase.from('users').update({
      messages_today: (userProfile?.messages_today || 0) + 1,
      last_reset_date: new Date().toISOString().split('T')[0],
    }).eq('id', user.id);

    try {
      const imageResult = await generateImage(message);
      if (conversationId) {
        await supabase.from('messages').insert({
          conversation_id: conversationId, role: 'user', content: message, model: 'gemini-3.1-flash-image',
        });
        await supabase.from('messages').insert({
          conversation_id: conversationId, role: 'assistant', content: imageResult.revisedPrompt, model: 'gemini-3.1-flash-image',
          attachments: [{ type: imageResult.mimeType, data: imageResult.imageBase64, name: 'generated-image.png' }],
        });
      }
      return new Response(
        JSON.stringify({ type: 'image', image: imageResult.imageBase64, mimeType: imageResult.mimeType, text: imageResult.revisedPrompt }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    } catch (error) {
      Sentry.captureException(error, { tags: { action: 'image_generation' } });
      return new Response(
        JSON.stringify({ error: 'Image generation failed' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  // ═══ OPEN SSE STREAM IMMEDIATELY — all heavy work runs inside ═══
  // Client gets the connection right away and sees real-time status updates
  const encoder = new TextEncoder();
  const abortController = new AbortController();
  req.signal.addEventListener('abort', () => abortController.abort());

  function sendSSE(controller: ReadableStreamDefaultController, data: Record<string, unknown>) {
    if (!abortController.signal.aborted) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
    }
  }

  const stream = new ReadableStream({
    async start(controller) {
      const heartbeatInterval = setInterval(() => {
        if (!abortController.signal.aborted) {
          controller.enqueue(encoder.encode(': heartbeat\n\n'));
        }
      }, 10000);

      try {
        // ═══ PHASE 1: STATUS -> processing (if attachments) or classifying ═══
        sendSSE(controller, { status: attachments?.length ? 'processing' : 'classifying' });

        // Increment message count (fire and forget — don't block)
        supabase.from('users').update({
          messages_today: (userProfile?.messages_today || 0) + 1,
          last_reset_date: new Date().toISOString().split('T')[0],
        }).eq('id', user!.id).then(() => {});

        // Fire-and-forget: memory invalidation
        if (conversationId) {
          detectAndHandleInvalidation(user!.id, conversationId, message)
            .catch(err => Sentry.captureException(err, { tags: { action: 'invalidation' } }));
        }

        // ═══ INPUT PROCESSING ═══
        let enrichedMessage = message;
        type DocProcessResult = { filename: string; summary: string; chunk_count: number; key_sections: string[] };
        const documentProcessingPromises: Promise<DocProcessResult>[] = [];
        const processedAttachments: Array<{ type: string; name: string; url?: string; size?: number }> = [];
        const resolvedAttachmentData: Map<number, string> = new Map();
        const imageDownloadPromises: Array<{ idx: number; promise: Promise<string | null> }> = [];

        // Queue for text extraction: download from storage + extract in parallel
        const textExtractionPromises: Array<{
          idx: number;
          att: typeof attachments[number];
          promise: Promise<string>;
        }> = [];

        if (attachments?.length) {
          for (let attIdx = 0; attIdx < attachments.length; attIdx++) {
            const att = attachments[attIdx];
            processedAttachments.push({
              type: att.type, name: att.name || 'file', url: att.url || undefined, size: att.size,
            });

            // Queue image downloads (don't await — will resolve in parallel)
            if (att.type.startsWith('image/') && att.storagePath) {
              imageDownloadPromises.push({ idx: attIdx, promise: downloadFromStorage(att.storagePath) });
              continue;
            }

            // If extractedText was provided (legacy), use it directly
            if (att.extractedText?.trim()) {
              textExtractionPromises.push({
                idx: attIdx,
                att,
                promise: Promise.resolve(att.extractedText),
              });
              continue;
            }

            // No extracted text — download from storage and extract server-side
            if (att.storagePath && !att.type.startsWith('image/')) {
              textExtractionPromises.push({
                idx: attIdx,
                att,
                promise: (async () => {
                  const base64 = await downloadFromStorage(att.storagePath!);
                  if (!base64) return '';
                  return extractTextFromFile(base64, att.type, att.name || 'file', (status, detail) => {
                    sendSSE(controller, { status, statusDetail: detail });
                  });
                })(),
              });
            }
          }
        }

        // ═══ MASSIVE PARALLEL PHASE ═══
        // Run ALL independent operations at once:
        // 1. Text extraction from storage (download + extract)
        // 2. Image downloads from storage
        // 3. Conversation data loading (conv metadata + recent messages)

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let conversation: any = null;
        let recentHistory: Array<{ role: string; content: string }> = [];
        let totalMessageCount = 0;
        let workingMemory: WorkingMemory | null = null;
        let structuredSummary: StructuredSummary | null = null;
        let documentRegistry: Array<{ filename: string; summary: string }> = [];

        const conversationLoadPromise = conversationId
          ? (async () => {
              const [convResult, msgsResult] = await Promise.all([
                supabase
                  .from('conversations')
                  .select('id, user_id, title, model, summary, system_prompt, topic, message_count, is_pinned, folder_id, created_at, updated_at, working_memory, document_registry, structured_summary, gemini_cache_name, key_entities, key_topics')
                  .eq('id', conversationId)
                  .single(),
                supabase
                  .from('messages')
                  .select('role, content, content_blocks')
                  .eq('conversation_id', conversationId)
                  .order('created_at', { ascending: false })
                  .limit(10),
              ]);
              const conv = convResult.data;
              conversation = conv;
              totalMessageCount = conv?.message_count || 0;
              workingMemory = conv?.working_memory as unknown as WorkingMemory | null;
              structuredSummary = conv?.structured_summary as unknown as StructuredSummary | null;
              documentRegistry = (conv?.document_registry as unknown as Array<{ filename: string; summary: string }>) || [];
              recentHistory = (msgsResult.data || []).reverse();
            })()
          : Promise.resolve();

        const textExtractionAllPromise = textExtractionPromises.length > 0
          ? Promise.all(textExtractionPromises.map(async (item) => {
              const text = await item.promise;
              return { ...item, extractedText: text };
            }))
          : Promise.resolve([] as Array<{ idx: number; att: typeof attachments[number]; extractedText: string }>);

        const imageDownloadAllPromise = imageDownloadPromises.length > 0
          ? Promise.all(imageDownloadPromises.map(async ({ idx, promise }) => {
              const data = await promise;
              if (data) resolvedAttachmentData.set(idx, data);
            }))
          : Promise.resolve();

        // Phase 1: text extraction + image downloads + conversation load (all parallel)
        const [extractedTexts] = await Promise.all([
          textExtractionAllPromise,
          imageDownloadAllPromise,
          conversationLoadPromise,
        ]);

        // Build enriched message from extracted texts
        const textParts: string[] = [];
        for (const { att, extractedText } of extractedTexts) {
          if (!extractedText?.trim()) {
            textParts.push(`[Attached file: ${att.name}]`);
            continue;
          }

          let label = 'file';
          if (att.type === 'application/pdf') label = 'PDF';
          else if (att.type.includes('word') || att.type === 'application/msword') label = 'Document';
          else if (att.type.includes('spreadsheet') || att.type.includes('excel') || att.type === 'text/csv') label = 'Spreadsheet';
          else if (att.type.includes('presentation') || att.type.includes('powerpoint')) label = 'Presentation';

          textParts.push(`[Attached ${label}: ${att.name}]\n${extractedText}`);

          if (conversationId) {
            const fileType = att.type === 'application/pdf' ? 'pdf'
              : att.type.includes('word') ? 'docx'
              : att.type.includes('presentation') ? 'pptx'
              : att.type;
            documentProcessingPromises.push(
              processDocument({
                userId: user!.id, conversationId, fileName: att.name || 'file', content: extractedText, fileType,
              })
            );
          }
        }
        if (textParts.length) {
          enrichedMessage = `${message}\n\n---\n${textParts.join('\n\n')}`;
        }

        // Phase 2: classification + doc processing (need enrichedMessage from phase 1)
        sendSSE(controller, { status: 'classifying' });
        const classificationPromise = classifyIntent(enrichedMessage, hasImageAttachment);

        const docProcessPromise = documentProcessingPromises.length > 0
          ? Promise.allSettled(documentProcessingPromises).then(results =>
              results
                .filter((r): r is PromiseFulfilledResult<DocProcessResult> => r.status === 'fulfilled')
                .map(r => r.value)
            )
          : Promise.resolve([] as DocProcessResult[]);

        const [docResults, rawIntent] = await Promise.all([
          docProcessPromise,
          classificationPromise,
        ]).then(([docRes, classRes]) => [docRes, classRes] as const);

        // ═══ GUARD: Only allow image routing when actual image files are attached ═══
        const intent = { ...rawIntent };
        if (!hasImageAttachment) {
          intent.hasImageInput = false;
          if (intent.routeOverride === 'gemini-3.1-flash-image') {
            intent.routeOverride = 'none';
          }
          if (intent.intent === 'image_analysis') {
            intent.intent = 'analysis';
          }
          const IMAGE_GEN_RE = /\b(צור תמונה|generate image|create image|draw|paint|illustrate|ציור|תמונה של|make a picture|design)\b/i;
          if (intent.needsImageGeneration && !IMAGE_GEN_RE.test(message)) {
            intent.needsImageGeneration = false;
          }
        }

        // Handle image generation detected by classifier (rare — most caught by early check)
        if (intent.needsImageGeneration) {
          try {
            const imageResult = await generateImage(message);
            if (conversationId) {
              await supabase.from('messages').insert({
                conversation_id: conversationId, role: 'user', content: message, model: 'gemini-3.1-flash-image',
              });
              await supabase.from('messages').insert({
                conversation_id: conversationId, role: 'assistant', content: imageResult.revisedPrompt, model: 'gemini-3.1-flash-image',
                attachments: [{ type: imageResult.mimeType, data: imageResult.imageBase64, name: 'generated-image.png' }],
              });
            }
            sendSSE(controller, { type: 'image', image: imageResult.imageBase64, mimeType: imageResult.mimeType, text: imageResult.revisedPrompt, done: true });
          } catch (error) {
            Sentry.captureException(error, { tags: { action: 'image_generation' } });
            sendSSE(controller, { error: 'Image generation failed' });
          }
          clearInterval(heartbeatInterval);
          controller.close();
          return;
        }

        if (docResults.length > 0) {
          const totalChunks = docResults.reduce((sum, d) => sum + d.chunk_count, 0);
          console.log(`[DocProcess] Processed ${docResults.length} documents, ${totalChunks} total chunks`);
        }

        // Determine actual model
        let actualModel: string;
        if (intent.routeOverride !== 'none') {
          actualModel = intent.routeOverride;
        } else {
          actualModel = routeByComplexity(model, intent.complexity);
        }

        // Save user message to DB (don't block streaming)
        if (conversationId) {
          supabase.from('messages').insert({
            conversation_id: conversationId,
            role: 'user',
            content: message,
            model: actualModel,
            attachments: processedAttachments.length > 0 ? processedAttachments : [],
          }).then(() => {});
        }

        // ═══ PHASE 2: STATUS -> searching_memory (RAG) ═══
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

        const hasDocuments = documentRegistry.length > 0 || docResults.some(d => d.chunk_count > 0);
        const shouldRunRAG = (intent.needsRAG || (hasDocuments && intent.referencesDocument)) && !!conversationId;

        let ragContext: RetrievedContext | null = null;
        if (shouldRunRAG && conversationId) {
          sendSSE(controller, { status: 'searching_memory' });
          try {
            const conversationContext = recentHistory
              .slice(-3)
              .map(m => `${m.role}: ${m.content.slice(0, 200)}`)
              .join('\n');

            const ragClassification = hasDocuments
              ? { ...intent, referencesDocument: true, needsRAG: true }
              : intent;

            ragContext = await retrieveMemories({
              userId: user!.id,
              conversationId,
              message,
              conversationContext,
              classification: ragClassification,
            });
          } catch (err) {
            Sentry.captureException(err, { tags: { action: 'rag_retrieval' } });
          }
        }

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

        // ═══ PHASE 3: STATUS -> generating ═══
        sendSSE(controller, { status: 'generating' });

        let generator;
        switch (actualModel) {
          case 'gpt-5.1':
          case 'gpt-5-mini':
            generator = streamGPT({
              systemPrompt,
              messages: assembledMessages,
              model: actualModel,
              userId: user!.id,
              conversationId: conversationId || undefined,
              signal: abortController.signal,
            });
            break;
          case 'gemini-3.1-pro':
          case 'gemini-3-flash':
          case 'gemini-3.1-flash-image': {
            if (actualModel === 'gemini-3.1-flash-image') {
              actualModel = 'gemini-3-flash';
            }
            const imageAttachments = (attachments || [])
              .map((a, idx) => ({ type: a.type, data: resolvedAttachmentData.get(idx), name: a.name }))
              .filter((a): a is { type: string; data: string; name: string } =>
                !!a.type?.startsWith('image') && !!a.data
              );

            generator = streamGemini({
              systemPrompt,
              messages: assembledMessages,
              model: actualModel as 'gemini-3.1-pro' | 'gemini-3-flash',
              enableSearch: intent.needsInternet,
              userId: user!.id,
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
              userId: user!.id,
              conversationId: conversationId || undefined,
              signal: abortController.signal,
            });
            break;
          default:
            throw new Error(`Unknown model: ${actualModel}`);
        }

        // Send routing info
        if (intent.routeOverride !== 'none') {
          sendSSE(controller, { routeOverride: actualModel });
        }

        for await (const event of generator) {
          if (abortController.signal.aborted) break;

          if (event.type === 'text') {
            sendSSE(controller, { text: event.text });
          } else if (event.type === 'error') {
            console.error('[Model Error]', event.text);
            sendSSE(controller, { error: event.text });
          } else if (event.type === 'done') {
            // ═══ LAYER 5: POST-PROCESSING (V4) — all fire-and-forget ═══
            if (conversationId) {
              // Save assistant message (await to ensure persistence)
              await supabase.from('messages').insert({
                conversation_id: conversationId,
                role: 'assistant',
                content: event.fullText || '',
                content_blocks: (event.contentBlocks ?? null) as import('@/lib/supabase/types').Json,
                model: actualModel,
              });

              const messageCount = totalMessageCount + 2;

              // All post-processing is fire-and-forget (non-blocking)
              if (ragContext?.tempMessageId) {
                promoteTempEmbedding(ragContext.tempMessageId).catch(err => Sentry.captureException(err));
              }
              if (event.fullText) {
                storeMessageEmbedding(user!.id, event.fullText, conversationId, 'assistant')
                  .catch(err => Sentry.captureException(err, { tags: { action: 'embed_assistant' } }));
              }
              if (event.usage) {
                supabase.from('usage_logs').insert({
                  user_id: user!.id, model: actualModel,
                  input_tokens: event.usage.inputTokens, output_tokens: event.usage.outputTokens,
                  cost_usd: event.usage.cost, endpoint: 'chat',
                }).then(() => {});
              }
              if (messageCount >= 6 && (messageCount === 6 || messageCount % 8 === 0)) {
                generateRollingSummary(conversation?.summary, structuredSummary, recentHistory.slice(-5), message, event.fullText || '')
                  .then(async ({ text, structured }) => { await saveStructuredSummary(conversationId, text, structured); })
                  .catch(err => Sentry.captureException(err));
              }
              if (messageCount % 3 === 0 || intent.workingMemoryPhase !== 'none') {
                updateWorkingMemory(conversationId, [...recentHistory.slice(-5), { role: 'user', content: message }, { role: 'assistant', content: event.fullText || '' }], intent)
                  .catch(err => Sentry.captureException(err));
              }
              if (messageCount > 0 && messageCount % 5 === 0 && event.fullText) {
                extractMemories(user!.id, message, event.fullText, conversationId)
                  .catch(err => Sentry.captureException(err, { tags: { action: 'extract_memories' } }));
              }
              if (event.fullText) {
                const lastAssistantMsg = recentHistory.filter(m => m.role === 'assistant').pop();
                if (lastAssistantMsg) {
                  detectAntiMemory(message, lastAssistantMsg.content, user!.id, conversationId).catch(err => Sentry.captureException(err));
                }
              }
              if (messageCount > 0 && messageCount % 20 === 0) {
                updateConversationFingerprint(conversationId).catch(err => Sentry.captureException(err));
              }
              if (totalMessageCount === 0) {
                generateTitle(message, event.fullText || '')
                  .then(async (title) => {
                    await supabase.from('conversations').update({ title, topic: intent.mainTopic, model: actualModel }).eq('id', conversationId);
                    try { sendSSE(controller, { titleUpdate: title }); } catch { /* controller may be closed */ }
                  })
                  .catch(err => Sentry.captureException(err));
              }
            }

            sendSSE(controller, { done: true, usage: event.usage });
          }
        }

        clearInterval(heartbeatInterval);
      } catch (error) {
        console.error('[Chat Stream Error]', error instanceof Error ? error.stack : error);
        Sentry.captureException(error, {
          tags: { action: 'stream' },
          extra: { conversationId, messageLength: message.length },
        });
        sendSSE(controller, { error: 'An error occurred. Please try again.' });
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
