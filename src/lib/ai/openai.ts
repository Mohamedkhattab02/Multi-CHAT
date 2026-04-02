import OpenAI from 'openai';
import { getOpenAIConfig } from '@/lib/monitoring/helicone';
import type { ModelId } from '@/lib/utils/constants';
import type { Attachment } from '@/lib/supabase/types';

// ============================================================
// GPT 5.1 / GPT-5-mini streaming handler
// Routes to gpt-5-mini for low complexity, gpt-5.1 for high
// ============================================================

export type OpenAIModelId = 'gpt-5.1' | 'gpt-5-mini';

const OPENAI_MODEL_MAP: Record<OpenAIModelId, string> = {
  'gpt-5.1': 'gpt-5.1',
  'gpt-5-mini': 'gpt-5-mini',
};

function buildOpenAIClient(userId?: string, conversationId?: string): OpenAI {
  const config = getOpenAIConfig(userId, conversationId);
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: config.baseURL,
    defaultHeaders: config.defaultHeaders,
  });
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | OpenAI.Chat.ChatCompletionContentPart[];
}

function buildMessagesWithAttachments(
  messages: ChatMessage[],
  attachments: Attachment[]
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const built: OpenAI.Chat.ChatCompletionMessageParam[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const isLast = i === messages.length - 1;

    // Only add attachments to the last user message
    if (isLast && msg.role === 'user' && attachments.length > 0) {
      const parts: OpenAI.Chat.ChatCompletionContentPart[] = [
        { type: 'text', text: typeof msg.content === 'string' ? msg.content : '' },
      ];

      for (const att of attachments) {
        if (att.type === 'image') {
          parts.push({
            type: 'image_url',
            image_url: { url: att.url, detail: 'auto' },
          });
        }
      }

      built.push({ role: 'user', content: parts });
    } else {
      built.push({
        role: msg.role,
        content: typeof msg.content === 'string' ? msg.content : '',
      });
    }
  }

  return built;
}

export async function streamOpenAI(params: {
  model: OpenAIModelId;
  messages: ChatMessage[];
  systemPrompt?: string;
  attachments?: Attachment[];
  userId?: string;
  conversationId?: string;
  onChunk: (text: string) => void;
  signal?: AbortSignal;
}): Promise<{ inputTokens: number; outputTokens: number }> {
  const { model, messages, systemPrompt, attachments = [], userId, conversationId, onChunk, signal } = params;

  const client = buildOpenAIClient(userId, conversationId);

  const allMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

  if (systemPrompt) {
    allMessages.push({ role: 'system', content: systemPrompt });
  }

  allMessages.push(...buildMessagesWithAttachments(messages, attachments));

  const openaiModel = OPENAI_MODEL_MAP[model] ?? 'gpt-5.1';

  let inputTokens = 0;
  let outputTokens = 0;

  const stream = await client.chat.completions.create(
    {
      model: openaiModel,
      messages: allMessages,
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: 4096,
      temperature: 0.7,
    },
    { signal }
  );

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) {
      onChunk(delta);
    }

    if (chunk.usage) {
      inputTokens = chunk.usage.prompt_tokens ?? 0;
      outputTokens = chunk.usage.completion_tokens ?? 0;
    }
  }

  return { inputTokens, outputTokens };
}
