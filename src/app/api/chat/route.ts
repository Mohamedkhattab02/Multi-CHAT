// ============================================================
// Main SSE Streaming Chat Endpoint — orchestrates all 7 layers
// POST /api/chat
// Features: Arcjet rate limiting, Zod validation, AbortController,
// heartbeat, Sentry capture, usage logging, smart routing
// ============================================================

import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { classifyIntent, routeByComplexity } from '@/lib/ai/classifier';
import { retrieveMemories } from '@/lib/memory/rag-pipeline';
import { assembleContext } from '@/lib/memory/context-assembler';
import { streamGPT } from '@/lib/ai/openai';
import { streamGemini } from '@/lib/ai/gemini';
import { streamGLM } from '@/lib/ai/glm';
import { generateImage } from '@/lib/ai/gemini-image';
import { generateRollingSummary, generateTitle } from '@/lib/memory/rolling-summary';
import { storeMessageEmbedding } from '@/lib/memory/embed-store';
import { extractMemories } from '@/lib/memory/extract-memories';
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
  // If user sends only attachments with no text, provide a default prompt
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

  // ═══ LAYER 1: INPUT PROCESSING + SMART ROUTING ═══
  const hasImageAttachment = attachments?.some((a) =>
    a.type?.startsWith('image')
  );

  // Extract text content from PDF/text attachments and append to message
  let enrichedMessage = message;
  if (attachments?.length) {
    const textParts: string[] = [];
    for (const att of attachments) {
      if (!att.data) continue;
      if (att.type === 'application/pdf') {
        // Decode base64 PDF and extract text
        try {
          const pdfText = await extractPdfText(att.data);
          if (pdfText.trim()) {
            textParts.push(`[Attached PDF: ${att.name}]\n${pdfText}`);
          }
        } catch (err) {
          Sentry.captureException(err, { tags: { action: 'pdf_extract' } });
          textParts.push(`[Attached PDF: ${att.name} — could not extract text]`);
        }
      } else if (att.type.startsWith('text/')) {
        try {
          const textContent = Buffer.from(att.data, 'base64').toString('utf-8');
          textParts.push(`[Attached file: ${att.name}]\n${textContent}`);
        } catch {
          textParts.push(`[Attached file: ${att.name} — could not read]`);
        }
      }
    }
    if (textParts.length) {
      enrichedMessage = `${message}\n\n---\n${textParts.join('\n\n')}`;
    }
  }

  const intent = await classifyIntent(enrichedMessage, hasImageAttachment);

  // ═══ SPECIAL ROUTE: Image Generation ═══
  if (intent.needsImageGeneration) {
    try {
      const imageResult = await generateImage(message);

      // Save user message
      if (conversationId) {
        await supabase.from('messages').insert({
          conversation_id: conversationId,
          role: 'user',
          content: message,
          model: 'gemini-3.1-flash-image',
        });
        // Save assistant image response
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

  // Determine actual model (with routing overrides + complexity routing)
  let actualModel: string;
  if (intent.routeOverride !== 'none') {
    // Special routes (image gen, web search, vision) override everything
    actualModel = intent.routeOverride;
  } else {
    // Smart complexity routing: downgrade easy questions, upgrade hard ones
    actualModel = routeByComplexity(model, intent.complexity);
  }

  // ═══ LAYER 2: MEMORY RETRIEVAL (RAG) + Reranking ═══
  let ragContext = '';
  if (intent.needsRAG) {
    try {
      ragContext = await retrieveMemories(user.id, message);
    } catch (err) {
      Sentry.captureException(err, { tags: { action: 'rag_retrieval' } });
    }
  }

  // ═══ LAYER 3: CONTEXT ASSEMBLY ═══
  let conversation = null;
  let history: Array<{ role: string; content: string }> = [];

  if (conversationId) {
    const { data: conv } = await supabase
      .from('conversations')
      .select('*')
      .eq('id', conversationId)
      .single();
    conversation = conv;

    const { data: msgs } = await supabase
      .from('messages')
      .select('role, content, content_blocks')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });
    history = msgs || [];

    // Save user message to DB
    await supabase.from('messages').insert({
      conversation_id: conversationId,
      role: 'user',
      content: message,
      model: actualModel,
      attachments: attachments || [],
    });

    // Embed user message in background (for RAG retrieval)
    storeMessageEmbedding(user.id, message, conversationId, 'user')
      .catch((err) => Sentry.captureException(err, { tags: { action: 'embed_user_msg' } }));
  }

  const { systemPrompt, messages: assembledMessages } = assembleContext({
    model: actualModel,
    userProfile,
    ragContext,
    messages: [...history, { role: 'user', content: enrichedMessage }],
    rollingSummary: conversation?.summary,
    language: intent.language,
  });

  // ═══ LAYER 4: GENERATION (STREAMING) with AbortController ═══
  const encoder = new TextEncoder();
  const abortController = new AbortController();

  // Clean up on client disconnect
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

        // Heartbeat to prevent timeout (every 15s)
        const heartbeatInterval = setInterval(() => {
          if (!abortController.signal.aborted) {
            controller.enqueue(encoder.encode(': heartbeat\n\n'));
          }
        }, 15000);

        // Send routing override info if applicable
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

            // ═══ LAYER 5: POST-PROCESSING ═══
            if (conversationId) {
              // Save assistant message
              await supabase.from('messages').insert({
                conversation_id: conversationId,
                role: 'assistant',
                content: event.fullText || '',
                content_blocks: (event.contentBlocks ?? null) as import('@/lib/supabase/types').Json,
                model: actualModel,
              });

              // Embed assistant message in background (for RAG retrieval)
              if (event.fullText) {
                storeMessageEmbedding(user.id, event.fullText, conversationId, 'assistant')
                  .catch((err) => Sentry.captureException(err, { tags: { action: 'embed_assistant_msg' } }));
              }

              // Usage logging
              if (event.usage) {
                await supabase
                  .from('usage_logs')
                  .insert({
                    user_id: user.id,
                    model: actualModel,
                    input_tokens: event.usage.inputTokens,
                    output_tokens: event.usage.outputTokens,
                    cost_usd: event.usage.cost,
                    endpoint: 'chat',
                  })
                  .then(() => {}); // non-critical, fire and forget
              }

              // Rolling summary every 10 messages
              const messageCount = (history?.length || 0) + 2;
              if (messageCount > 12 && messageCount % 10 === 0) {
                generateRollingSummary(
                  conversation?.summary,
                  history.slice(-10),
                  message,
                  event.fullText || ''
                )
                  .then(async (summary) => {
                    await supabase
                      .from('conversations')
                      .update({ summary })
                      .eq('id', conversationId);
                  })
                  .catch((err) => Sentry.captureException(err));
              }

              // Extract memories every 5 messages (fire and forget)
              if (messageCount % 5 === 0 && event.fullText) {
                extractMemories(user.id, message, event.fullText)
                  .catch((err) => Sentry.captureException(err, { tags: { action: 'extract_memories' } }));
              }

              // Auto-generate title for new conversations + update model
              if (history.length === 0) {
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
                  .catch((err) => Sentry.captureException(err));
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
