// ============================================================
// Gemini 3.1 Pro / Gemini 3 Flash streaming handler
// Supports search grounding for real-time data queries
// ============================================================

import { GoogleGenerativeAI, type GenerateContentStreamResult } from '@google/generative-ai';
import * as Sentry from '@sentry/nextjs';
import type { StreamEvent } from './openai';

interface StreamGeminiParams {
  systemPrompt: string;
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  model: 'gemini-3.1-pro' | 'gemini-3-flash';
  enableSearch?: boolean;
  userId?: string;
  conversationId?: string;
  signal?: AbortSignal;
}

const MODEL_MAP: Record<string, string> = {
  'gemini-3.1-pro': 'gemini-3.1-pro-preview',
  'gemini-3-flash': 'gemini-3-flash-preview',
};

const COST_PER_M: Record<string, { input: number; output: number }> = {
  'gemini-3.1-pro': { input: 1.25, output: 5 },
  'gemini-3-flash': { input: 0.075, output: 0.3 },
};

export async function* streamGemini(params: StreamGeminiParams): AsyncGenerator<StreamEvent> {
  const { systemPrompt, messages, model, enableSearch = false, signal } = params;

  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY!);

  const tools: Array<{ googleSearch: Record<string, never> }> = [];
  if (enableSearch) {
    tools.push({ googleSearch: {} });
  }

  const geminiModel = genAI.getGenerativeModel({
    model: MODEL_MAP[model] || model,
    systemInstruction: systemPrompt,
    generationConfig: {
      maxOutputTokens: model === 'gemini-3.1-pro' ? 8192 : 4096,
      temperature: 0.7,
    },
    // @ts-expect-error -- google search tool typing not yet in SDK
    tools: tools.length > 0 ? tools : undefined,
  });

  // Convert messages to Gemini format (alternating user/model)
  const geminiHistory = convertToGeminiHistory(messages.slice(0, -1));
  const lastMessage = messages[messages.length - 1];

  try {
    const chat = geminiModel.startChat({
      history: geminiHistory,
    });

    const result: GenerateContentStreamResult = await chat.sendMessageStream(
      lastMessage.content
    );

    let fullText = '';

    for await (const chunk of result.stream) {
      if (signal?.aborted) break;

      const text = chunk.text();
      if (text) {
        fullText += text;
        yield { type: 'text', text };
      }
    }

    // Get usage metadata from the aggregated response
    const response = await result.response;
    const usage = response.usageMetadata;
    const inputTokens = usage?.promptTokenCount ?? 0;
    const outputTokens = usage?.candidatesTokenCount ?? 0;

    const costs = COST_PER_M[model] || COST_PER_M['gemini-3-flash'];
    const cost = (inputTokens / 1_000_000) * costs.input + (outputTokens / 1_000_000) * costs.output;

    yield {
      type: 'done',
      fullText,
      usage: { inputTokens, outputTokens, cost },
    };
  } catch (error) {
    Sentry.captureException(error, {
      tags: { model, action: 'stream_gemini' },
    });
    yield { type: 'error', text: `Gemini error: ${error instanceof Error ? error.message : 'Unknown error'}` };
  }
}

function convertToGeminiHistory(messages: Array<{ role: string; content: string }>) {
  return messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
}
