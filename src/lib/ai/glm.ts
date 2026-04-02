// ============================================================
// GLM 5 streaming handler (ZhipuAI / BigModel API)
// Uses OpenAI-compatible API format
// ============================================================

import * as Sentry from '@sentry/nextjs';
import type { StreamEvent } from './openai';

interface StreamGLMParams {
  systemPrompt: string;
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  userId?: string;
  conversationId?: string;
  signal?: AbortSignal;
}

const GLM_API_BASE = 'https://open.bigmodel.cn/api/v4/chat/completions';

const COST_PER_M = { input: 0.1, output: 0.1 };

export async function* streamGLM(params: StreamGLMParams): AsyncGenerator<StreamEvent> {
  const { systemPrompt, messages, signal } = params;

  try {
    const response = await fetch(GLM_API_BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'glm-5',
        stream: true,
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages,
        ],
        max_tokens: 4096,
        temperature: 0.7,
      }),
      signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => 'Unknown error');
      throw new Error(`GLM API error ${response.status}: ${errText}`);
    }

    if (!response.body) {
      throw new Error('GLM API returned no response body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let buffer = '';
    let inputTokens = 0;
    let outputTokens = 0;

    while (true) {
      if (signal?.aborted) break;

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;

        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            fullText += delta;
            yield { type: 'text', text: delta };
          }

          // Usage in final chunk
          if (parsed.usage) {
            inputTokens = parsed.usage.prompt_tokens ?? 0;
            outputTokens = parsed.usage.completion_tokens ?? 0;
          }
        } catch {
          // Skip malformed JSON lines
        }
      }
    }

    const cost =
      (inputTokens / 1_000_000) * COST_PER_M.input +
      (outputTokens / 1_000_000) * COST_PER_M.output;

    yield {
      type: 'done',
      fullText,
      usage: { inputTokens, outputTokens, cost },
    };
  } catch (error) {
    if (signal?.aborted) return;
    Sentry.captureException(error, {
      tags: { model: 'glm-5', action: 'stream_glm' },
    });
    yield { type: 'error', text: `GLM error: ${error instanceof Error ? error.message : 'Unknown error'}` };
  }
}
