// ============================================================
// Main SSE Streaming Chat Endpoint — orchestrates all 7 layers
// POST /api/chat
// Features: Arcjet rate limiting, Zod validation, AbortController,
// heartbeat, Sentry capture, usage logging, smart routing
// ============================================================

import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { classifyIntent } from '@/lib/ai/classifier';
import { retrieveMemories } from '@/lib/memory/rag-pipeline';
import { assembleContext } from '@/lib/memory/context-assembler';
import { streamGPT } from '@/lib/ai/openai';
import { streamGemini } from '@/lib/ai/gemini';
import { streamGLM } from '@/lib/ai/glm';
import { generateImage } from '@/lib/ai/gemini-image';
import { generateRollingSummary, generateTitle } from '@/lib/memory/rolling-summary';
import { ChatMessageSchema } from '@/lib/security/validate';
import * as Sentry from '@sentry/nextjs';
import { z } from 'zod';

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
      return new Response(
        JSON.stringify({ error: 'Invalid input', details: error.issues }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response('Bad request', { status: 400 });
  }

  const { message, conversationId, model, attachments } = body;
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
  const intent = await classifyIntent(message, hasImageAttachment);

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

  // Determine actual model (with routing overrides)
  const actualModel =
    intent.routeOverride !== 'none' ? intent.routeOverride : model;

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
  }

  const { systemPrompt, messages: assembledMessages } = assembleContext({
    model: actualModel,
    userProfile,
    ragContext,
    messages: [...history, { role: 'user', content: message }],
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
          case 'glm-5':
            generator = streamGLM({
              systemPrompt,
              messages: assembledMessages,
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
