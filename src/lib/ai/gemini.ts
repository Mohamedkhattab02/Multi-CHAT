import {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
  type Content,
  type Part,
} from '@google/generative-ai';
import type { Attachment } from '@/lib/supabase/types';

// ============================================================
// Gemini 3.1 Pro / Gemini 3 Flash streaming handler
// Flash has Google Search grounding for real-time queries
// ============================================================

export type GeminiModelId = 'gemini-3.1-pro' | 'gemini-3-flash';

const GEMINI_MODEL_MAP: Record<GeminiModelId, string> = {
  'gemini-3.1-pro': 'gemini-2.5-pro-preview-05-06',
  'gemini-3-flash': 'gemini-2.0-flash',
};

const SAFETY_SETTINGS = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
];

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

async function urlToBase64(url: string): Promise<{ data: string; mimeType: string }> {
  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const data = btoa(binary);
  const mimeType = response.headers.get('content-type') ?? 'image/jpeg';
  return { data, mimeType };
}

async function buildGeminiContents(
  messages: ChatMessage[],
  attachments: Attachment[]
): Promise<Content[]> {
  const contents: Content[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === 'system') continue; // system handled via systemInstruction

    const isLast = i === messages.length - 1;
    const parts: Part[] = [];

    if (isLast && msg.role === 'user' && attachments.length > 0) {
      for (const att of attachments) {
        if (att.type === 'image') {
          try {
            const { data, mimeType } = await urlToBase64(att.url);
            parts.push({ inlineData: { data, mimeType } } as Part);
          } catch {
            // Skip failed image loads
          }
        }
      }
    }

    parts.push({ text: msg.content });

    contents.push({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts,
    });
  }

  return contents;
}

export async function streamGemini(params: {
  model: GeminiModelId;
  messages: ChatMessage[];
  systemPrompt?: string;
  attachments?: Attachment[];
  needsInternet?: boolean;
  onChunk: (text: string) => void;
  signal?: AbortSignal;
}): Promise<{ inputTokens: number; outputTokens: number }> {
  const { model, messages, systemPrompt, attachments = [], needsInternet = false, onChunk, signal } = params;

  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY ?? '');
  const modelName = GEMINI_MODEL_MAP[model] ?? 'gemini-2.0-flash';

  // Google Search grounding only available on Flash
  const tools: object[] = [];
  if (needsInternet && model === 'gemini-3-flash') {
    tools.push({ googleSearch: {} });
  }

  const geminiModel = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: systemPrompt,
    safetySettings: SAFETY_SETTINGS,
    ...(tools.length > 0 ? { tools: tools as never } : {}),
  });

  const contents = await buildGeminiContents(messages, attachments);

  // Remove last message from history; it becomes the new user message
  const lastContent = contents.pop();
  const lastUserText = lastContent?.parts?.find((p): p is { text: string } => 'text' in p)?.text ?? '';

  const chat = geminiModel.startChat({
    history: contents,
    generationConfig: {
      maxOutputTokens: 8192,
      temperature: 0.7,
    },
  });

  let inputTokens = 0;
  let outputTokens = 0;

  const result = await chat.sendMessageStream(lastUserText, { signal } as never);

  for await (const chunk of result.stream) {
    const text = chunk.text();
    if (text) onChunk(text);
  }

  const finalResponse = await result.response;
  inputTokens = finalResponse.usageMetadata?.promptTokenCount ?? 0;
  outputTokens = finalResponse.usageMetadata?.candidatesTokenCount ?? 0;

  return { inputTokens, outputTokens };
}
