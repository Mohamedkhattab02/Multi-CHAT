// ============================================================
// OpenAI GPT 5.1 / gpt-5-mini streaming handler
// Proxied through Helicone for observability
// ============================================================

import OpenAI from 'openai';
import { getOpenAIConfig } from '@/lib/monitoring/helicone';
import * as Sentry from '@sentry/nextjs';

export interface StreamEvent {
  type: 'text' | 'done' | 'error';
  text?: string;
  fullText?: string;
  contentBlocks?: unknown;
  usage?: { inputTokens: number; outputTokens: number; cost: number };
}

interface StreamGPTParams {
  systemPrompt: string;
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  model: 'gpt-5.1' | 'gpt-5-mini';
  userId?: string;
  conversationId?: string;
  signal?: AbortSignal;
}

const MODEL_MAP: Record<string, string> = {
  'gpt-5.1': 'gpt-5.1',
  'gpt-5-mini': 'gpt-5-mini',
};

const COST_PER_M: Record<string, { input: number; output: number }> = {
  'gpt-5.1': { input: 15, output: 60 },
  'gpt-5-mini': { input: 0.15, output: 0.6 },
};

export async function* streamGPT(params: StreamGPTParams): AsyncGenerator<StreamEvent> {
  const { systemPrompt, messages, model, userId, conversationId, signal } = params;

  const heliconeConfig = getOpenAIConfig(userId, conversationId);
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    ...heliconeConfig,
  });

  const apiModel = MODEL_MAP[model] || model;

  try {
    const stream = await openai.chat.completions.create(
      {
        model: apiModel,
        stream: true,
        stream_options: { include_usage: true },
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages,
        ],
        max_tokens: model === 'gpt-5.1' ? 16384 : 8192,
        temperature: 0.7,
      },
      { signal }
    );

    let fullText = '';
    let inputTokens = 0;
    let outputTokens = 0;

    for await (const chunk of stream) {
      if (signal?.aborted) break;

      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) {
        fullText += delta;
        yield { type: 'text', text: delta };
      }

      // Usage info comes in the final chunk
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens ?? 0;
        outputTokens = chunk.usage.completion_tokens ?? 0;
      }
    }

    const costs = COST_PER_M[model] || COST_PER_M['gpt-5-mini'];
    const cost = (inputTokens / 1_000_000) * costs.input + (outputTokens / 1_000_000) * costs.output;

    yield {
      type: 'done',
      fullText,
      usage: { inputTokens, outputTokens, cost },
    };
  } catch (error) {
    Sentry.captureException(error, {
      tags: { model, action: 'stream_gpt' },
    });
    yield { type: 'error', text: `OpenAI error: ${error instanceof Error ? error.message : 'Unknown error'}` };
  }
}
