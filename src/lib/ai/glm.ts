import type { Attachment } from '@/lib/supabase/types';

// ============================================================
// GLM 5 streaming handler — ZhipuAI API
// Uses fetch directly (no official JS SDK with streaming support)
// ============================================================

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface GLMMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | GLMContentPart[];
}

interface GLMContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
}

function buildGLMMessages(
  messages: ChatMessage[],
  attachments: Attachment[]
): GLMMessage[] {
  return messages.map((msg, i) => {
    const isLast = i === messages.length - 1;

    if (isLast && msg.role === 'user' && attachments.length > 0) {
      const parts: GLMContentPart[] = [{ type: 'text', text: msg.content }];
      for (const att of attachments) {
        if (att.type === 'image') {
          parts.push({ type: 'image_url', image_url: { url: att.url } });
        }
      }
      return { role: 'user', content: parts };
    }

    return { role: msg.role, content: msg.content };
  });
}

export async function streamGLM(params: {
  messages: ChatMessage[];
  systemPrompt?: string;
  attachments?: Attachment[];
  onChunk: (text: string) => void;
  signal?: AbortSignal;
}): Promise<{ inputTokens: number; outputTokens: number }> {
  const { messages, systemPrompt, attachments = [], onChunk, signal } = params;

  const allMessages: GLMMessage[] = [];
  if (systemPrompt) {
    allMessages.push({ role: 'system', content: systemPrompt });
  }
  allMessages.push(...buildGLMMessages(messages, attachments));

  const response = await fetch('https://open.bigmodel.cn/api/v4/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.GLM_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'glm-4',
      messages: allMessages,
      stream: true,
      max_tokens: 8192,
      temperature: 0.7,
    }),
    signal,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`GLM API error ${response.status}: ${errText}`);
  }

  if (!response.body) throw new Error('GLM returned empty response body');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === ': heartbeat') continue;

        const dataStr = trimmed.startsWith('data: ') ? trimmed.slice(6) : trimmed;
        if (dataStr === '[DONE]') continue;

        try {
          const json = JSON.parse(dataStr);
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) onChunk(delta);

          if (json.usage) {
            inputTokens = json.usage.prompt_tokens ?? 0;
            outputTokens = json.usage.completion_tokens ?? 0;
          }
        } catch {
          // Skip malformed JSON lines
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return { inputTokens, outputTokens };
}
