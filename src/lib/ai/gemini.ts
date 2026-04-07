// ============================================================
// Gemini 3.1 Pro / Gemini 3 Flash streaming handler
// Supports search grounding for real-time data queries
// ============================================================

import { GoogleGenerativeAI, type GenerateContentStreamResult } from '@google/generative-ai';
import * as Sentry from '@sentry/nextjs';
import type { StreamEvent } from './openai';

interface ImageAttachment {
  type: string;
  data: string;
  name?: string;
}

interface StreamGeminiParams {
  systemPrompt: string;
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  model: 'gemini-3.1-pro' | 'gemini-3-flash';
  enableSearch?: boolean;
  userId?: string;
  conversationId?: string;
  signal?: AbortSignal;
  imageAttachments?: ImageAttachment[];
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
  const { systemPrompt, messages, model, enableSearch = false, signal, imageAttachments = [] } = params;

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

  // Safety: ensure we have a user message to send
  if (!lastMessage || lastMessage.role !== 'user') {
    yield {
      type: 'error',
      text: 'No user message to send to Gemini.',
    };
    return;
  }

  try {
    const chat = geminiModel.startChat({
      history: geminiHistory,
    });

    // Build message parts: text + optional images
    const messageParts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];

    // Add text part
    if (lastMessage.content) {
      messageParts.push({ text: lastMessage.content });
    }

    // Add image attachments as inlineData
    for (const img of imageAttachments) {
      messageParts.push({
        inlineData: {
          mimeType: img.type,
          data: img.data,
        },
      });
    }

    // Fallback: if no parts at all, add empty text
    if (messageParts.length === 0) {
      messageParts.push({ text: '' });
    }

    const result: GenerateContentStreamResult = await chat.sendMessageStream(
      messageParts
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

/**
 * Convert chat messages to Gemini history format.
 *
 * Gemini enforces TWO rules:
 *   1. First turn MUST be 'user'
 *   2. Turns MUST strictly alternate: user → model → user → model ...
 *
 * Since sendMessageStream sends the final user message separately,
 * the history must:
 *   - Start with 'user'
 *   - End with 'model' (so the next user message alternates correctly)
 */
function convertToGeminiHistory(
  messages: Array<{ role: string; content: string }>
): Array<{ role: string; parts: Array<{ text: string }> }> {
  // Step 1: filter out system messages and empty content
  const filtered = messages.filter(
    (m) => m.role !== 'system' && m.content.trim().length > 0
  );

  if (filtered.length === 0) return [];

  // Step 2: convert roles and merge consecutive same-role messages
  const merged: Array<{ role: string; parts: Array<{ text: string }> }> = [];
  for (const m of filtered) {
    const geminiRole = m.role === 'assistant' ? 'model' : 'user';
    const last = merged[merged.length - 1];

    if (last && last.role === geminiRole) {
      // Same role as previous — merge content
      last.parts[0].text += '\n\n' + m.content;
    } else {
      merged.push({ role: geminiRole, parts: [{ text: m.content }] });
    }
  }

  // Step 3: enforce first = 'user'
  // If history starts with 'model', the previous assistant response
  // leaked in. Drop it — it's not useful as history context anyway.
  while (merged.length > 0 && merged[0].role === 'model') {
    merged.shift();
  }

  // Step 4: enforce last = 'model'
  // History is passed to startChat(), then sendMessageStream() sends
  // the final user message. If history ends with 'user', we'd get
  // two consecutive 'user' turns → API error.
  // Drop trailing 'user' entries.
  while (merged.length > 0 && merged[merged.length - 1].role === 'user') {
    merged.pop();
  }

  return merged;
}