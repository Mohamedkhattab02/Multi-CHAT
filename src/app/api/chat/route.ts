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
import { createClient } from '@/lib/supabase/server';
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
import * as Sentry from '@sentry/nextjs';
import { z } from 'zod';
import pdfParse from 'pdf-parse-new';

async function extractPdfText(base64Data: string): Promise<string> {
  const buffer = Buffer.from(base64Data, 'base64');
  const result = await pdfParse(buffer);
  return result.text.slice(0, 8000);
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

  // Get authenticated user
  const {
    data: { user },
  } = await supabase.auth.getUser();
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

  // Extract text content from PDF/text attachments
  let enrichedMessage = message;
  const documentProcessingPromises: Promise<void>[] = [];

  if (attachments?.length) {
    const textParts: string[] = [];
    for (const att of attachments) {
      if (!att.data) continue;
      if (att.type === 'application/pdf') {
        try {
          const pdfText = await extractPdfText(att.data);
          if (pdfText.trim()) {
            textParts.push(`[Attached PDF: ${att.name}]\n${pdfText}`);
            // V4: Process document with structure-aware chunking
            if (conversationId) {
              documentProcessingPromises.push(
                processDocument({
                  userId: user.id,
                  conversationId,
                  fileName: att.name || 'document.pdf',
                  content: pdfText,
                  fileType: 'pdf',
                }).then(() => {})
              );
            }
          }
        } catch (err) {
          Sentry.captureException(err, { tags: { action: 'pdf_extract' } });
          textParts.push(`[Attached PDF: ${att.name} — could not extract text]`);
        }
      } else if (att.type.startsWith('text/')) {
        try {
          const textContent = Buffer.from(att.data, 'base64').toString('utf-8');
          textParts.push(`[Attached file: ${att.name}]\n${textContent}`);
          // V4: Process text documents too
          if (conversationId) {
            documentProcessingPromises.push(
              processDocument({
                userId: user.id,
                conversationId,
                fileName: att.name || 'file.txt',
                content: textContent,
                fileType: att.type,
              }).then(() => {})
            );
          }
        } catch {
          textParts.push(`[Attached file: ${att.name} — could not read]`);
        }
      }
    }
    if (textParts.length) {
      enrichedMessage = `${message}\n\n---\n${textParts.join('\n\n')}`;
    }
  }

  // Fire document processing in background
  if (documentProcessingPromises.length > 0) {
    Promise.all(documentProcessingPromises)
      .catch(err => Sentry.captureException(err, { tags: { action: 'document_processing' } }));
  }

  const intent = await classifyIntent(enrichedMessage, hasImageAttachment);

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
      Sentry.captureException(error, { tags: { action: 'image_generation' } });
      return new Response(
        JSON.stringify({ error: 'Image generation failed' }),
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

    // Save user message to DB
    await supabase.from('messages').insert({
      conversation_id: conversationId,
      role: 'user',
      content: message,
      model: actualModel,
      attachments: attachments || [],
    });
  }

  // ═══ LAYER 2: MEMORY RETRIEVAL (RAG) — V4 8-step pipeline ═══
  // Force RAG when conversation has documents — user may reference them at any time
  const hasDocuments = documentRegistry.length > 0;
  const shouldRunRAG = (intent.needsRAG || hasDocuments) && !!conversationId;

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
    documentRegistry,
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
            generator = streamGemini({
              systemPrompt,
              messages: assembledMessages,
              model: actualModel,
              enableSearch: intent.needsInternet,
              userId: user.id,
              conversationId: conversationId || undefined,
              signal: abortController.signal,
            });
            break;
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

              // Auto-generate title for new conversations
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
