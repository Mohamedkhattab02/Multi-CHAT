import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { ChatMessageSchema } from '@/lib/security/validate';
import { chatRateLimit } from '@/lib/security/rate-limit';
import { classifyIntent } from '@/lib/ai/classifier';
import { resolveModel } from '@/lib/ai/router';
import { streamOpenAI } from '@/lib/ai/openai';
import { streamGemini } from '@/lib/ai/gemini';
import { generateImage } from '@/lib/ai/gemini-image';
import { streamGLM } from '@/lib/ai/glm';
import { captureAIError } from '@/lib/monitoring/sentry';
import type { ModelId } from '@/lib/utils/constants';
import type { ChatMessage as OpenAIChatMessage } from '@/lib/ai/openai';
import type { ChatMessage as GeminiChatMessage } from '@/lib/ai/gemini';
import type { ChatMessage as GLMChatMessage } from '@/lib/ai/glm';

// ============================================================
// /api/chat — SSE streaming endpoint
// Protocol:
//   data: {"text":"token"}\n\n      — content chunk
//   data: {"model":"...","override":"..."}\n\n  — metadata (first event)
//   : heartbeat\n\n                 — keep-alive every 15s
//   data: [DONE]\n\n                — stream end
//   data: {"error":"msg"}\n\n       — error
// ============================================================

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function sse(data: string): string {
  return `data: ${data}\n\n`;
}

function heartbeat(): string {
  return `: heartbeat\n\n`;
}

export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();

  // ── Auth ───────────────────────────────────────────────────
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── Rate limiting ──────────────────────────────────────────
  const rateResult = await chatRateLimit.protect(req, { userId: user.id, requested: 1 });
  if (rateResult.isDenied()) {
    return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── Parse & validate input ─────────────────────────────────
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  const parsed = ChatMessageSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: 'Validation failed', details: parsed.error.flatten() }),
      { status: 400 }
    );
  }

  const { conversationId, message, model: userModel, attachments = [] } = parsed.data;

  // ── Load conversation history ──────────────────────────────
  let historyMessages: OpenAIChatMessage[] = [];
  let systemPrompt: string | undefined;

  if (conversationId) {
    const { data: conv } = await supabase
      .from('conversations')
      .select('system_prompt, summary')
      .eq('id', conversationId)
      .eq('user_id', user.id)
      .single();

    if (conv?.system_prompt) systemPrompt = conv.system_prompt;

    const { data: msgs } = await supabase
      .from('messages')
      .select('role, content')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(24); // keep last 24 messages (12 turns)

    if (msgs) {
      historyMessages = (msgs as { role: string; content: string }[])
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
    }

    // Prepend rolling summary if present
    if (conv?.summary) {
      historyMessages = [
        { role: 'user', content: '[Previous conversation summary below]' },
        { role: 'assistant', content: conv.summary },
        ...historyMessages,
      ];
    }
  }

  // Add current user message
  historyMessages.push({ role: 'user', content: message });

  // ── Classify intent ────────────────────────────────────────
  const hasImageAttachment = attachments.some((a) => a.type === 'image');
  const classification = await classifyIntent(message, hasImageAttachment);
  const { finalModel, wasOverridden, overrideReason } = resolveModel(userModel as ModelId, classification);

  // ── Save user message to DB ────────────────────────────────
  let savedConversationId = conversationId;

  if (!savedConversationId) {
    // Auto-create conversation
    const title = message.slice(0, 60) + (message.length > 60 ? '…' : '');
    const { data: newConv } = await supabase
      .from('conversations')
      .insert({ user_id: user.id, title, model: finalModel })
      .select('id')
      .single();
    savedConversationId = newConv?.id;
  }

  if (savedConversationId) {
    await supabase.from('messages').insert({
      conversation_id: savedConversationId,
      role: 'user',
      content: message,
      attachments: attachments as never,
    });
  }

  // ── Build SSE ReadableStream ───────────────────────────────
  const abortController = new AbortController();

  // Abort on client disconnect
  req.signal.addEventListener('abort', () => abortController.abort());

  const stream = new ReadableStream({
    async start(controller) {
      let assistantContent = '';
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
      let inputTokens = 0;
      let outputTokens = 0;

      const send = (data: string) => {
        try {
          controller.enqueue(encoder.encode(data));
        } catch {
          // Stream may be closed
        }
      };

      // Send metadata as first event
      send(sse(JSON.stringify({
        model: finalModel,
        override: wasOverridden ? overrideReason : null,
        conversationId: savedConversationId,
      })));

      // Heartbeat every 15s
      heartbeatTimer = setInterval(() => send(heartbeat()), 15000);

      const onChunk = (text: string) => {
        assistantContent += text;
        send(sse(JSON.stringify({ text })));
      };

      try {
        if (classification.needsImageGeneration) {
          // ── Image generation path ──────────────────────────
          send(sse(JSON.stringify({ text: 'Generating image...\n\n' })));

          const imageResult = await generateImage({ prompt: message });

          // Send the image as a special event
          send(sse(JSON.stringify({
            imageUrl: imageResult.imageUrl,
            mimeType: imageResult.mimeType,
          })));

          assistantContent = imageResult.textResponse
            ? `${imageResult.textResponse}\n\n![Generated Image](${imageResult.imageUrl})`
            : `![Generated Image](${imageResult.imageUrl})`;

        } else if (finalModel === 'gpt-5.1' || finalModel === 'gpt-5-mini') {
          // ── OpenAI path ────────────────────────────────────
          const result = await streamOpenAI({
            model: finalModel,
            messages: historyMessages as OpenAIChatMessage[],
            systemPrompt,
            attachments,
            userId: user.id,
            conversationId: savedConversationId ?? undefined,
            onChunk,
            signal: abortController.signal,
          });
          inputTokens = result.inputTokens;
          outputTokens = result.outputTokens;

        } else if (finalModel === 'gemini-3.1-pro' || finalModel === 'gemini-3-flash') {
          // ── Gemini path ────────────────────────────────────
          const result = await streamGemini({
            model: finalModel,
            messages: historyMessages as GeminiChatMessage[],
            systemPrompt,
            attachments,
            needsInternet: classification.needsInternet,
            onChunk,
            signal: abortController.signal,
          });
          inputTokens = result.inputTokens;
          outputTokens = result.outputTokens;

        } else if (finalModel === 'glm-5') {
          // ── GLM path ───────────────────────────────────────
          const result = await streamGLM({
            messages: historyMessages as GLMChatMessage[],
            systemPrompt,
            attachments,
            onChunk,
            signal: abortController.signal,
          });
          inputTokens = result.inputTokens;
          outputTokens = result.outputTokens;
        }

        // ── Save assistant message ─────────────────────────
        if (savedConversationId && assistantContent) {
          await supabase.from('messages').insert({
            conversation_id: savedConversationId,
            role: 'assistant',
            content: assistantContent,
            model: finalModel,
            token_count: outputTokens,
          });

          // Log usage
          if (inputTokens > 0 || outputTokens > 0) {
            await supabase.from('usage_logs').insert({
              user_id: user.id,
              model: finalModel,
              input_tokens: inputTokens,
              output_tokens: outputTokens,
              endpoint: 'chat',
            });
          }
        }

        send(sse('[DONE]'));
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') {
          // Client disconnected — normal, save partial content
          if (savedConversationId && assistantContent) {
            await supabase.from('messages').insert({
              conversation_id: savedConversationId,
              role: 'assistant',
              content: assistantContent + ' [interrupted]',
              model: finalModel,
            });
          }
        } else {
          captureAIError(err as Error, { model: finalModel, action: 'stream', userId: user.id, conversationId: savedConversationId ?? undefined });
          console.error('[chat/route] Stream error:', err);
          send(sse(JSON.stringify({ error: 'AI model error — please try again' })));
        }
      } finally {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
