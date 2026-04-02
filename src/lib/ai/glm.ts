// ============================================================
// GLM streaming handler (ZhipuAI / BigModel API)
// Uses OpenAI-compatible API format
// Strong: GLM 4.7 | Simple: GLM 4.6
// ============================================================

import * as Sentry from '@sentry/nextjs';
import type { StreamEvent } from './openai';

interface StreamGLMParams {
  systemPrompt: string;
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  model: 'glm-4.7' | 'glm-4.6';
  userId?: string;
  conversationId?: string;
  signal?: AbortSignal;
}

const GLM_API_BASE = 'https://open.bigmodel.cn/api/v4/chat/completions';

const COST_PER_M: Record<string, { input: number; output: number }> = {
  'glm-4.7': { input: 0.5, output: 0.5 },
  'glm-4.6': { input: 0.1, output: 0.1 },
};

const MODEL_MAP: Record<string, string> = {
  'glm-4.7': 'glm-4-plus',
  'glm-4.6': 'glm-4-flash',
};

export async function* streamGLM(params: StreamGLMParams): AsyncGenerator<StreamEvent> {
  const { systemPrompt, messages, model, signal } = params;

  try {
    const response = await fetch(GLM_API_BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL_MAP[model] || model,
        stream: true,
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages,
        ],
        max_tokens: model === 'glm-4.7' ? 8192 : 4096,
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

    const costs = COST_PER_M[model] || COST_PER_M['glm-4.6'];
    const cost =
      (inputTokens / 1_000_000) * costs.input +
      (outputTokens / 1_000_000) * costs.output;

    yield {
      type: 'done',
      fullText,
      usage: { inputTokens, outputTokens, cost },
    };
  } catch (error) {
    if (signal?.aborted) return;
    Sentry.captureException(error, {
      tags: { model, action: 'stream_glm' },
    });
    yield { type: 'error', text: `GLM error: ${error instanceof Error ? error.message : 'Unknown error'}` };
  }
}
