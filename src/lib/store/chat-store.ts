import { create } from 'zustand';
import type { Message } from '@/lib/supabase/types';

type ModelId = 'gpt-5.1' | 'gpt-5-mini' | 'gemini-3.1-pro' | 'gemini-3-flash' | 'gemini-3.1-flash-image' | 'glm-4.7' | 'glm-4.6';

export type StreamingStatus =
  | 'idle'
  | 'uploading'
  | 'classifying'
  | 'searching_memory'
  | 'generating'
  | 'processing'
  | 'extracting_document'
  | 'extracting_pages'
  | 'analyzing_images';

interface ChatStore {
  // Active conversation
  activeConversationId: string | null;
  messages: Message[];
  selectedModel: ModelId;

  // Streaming state
  isStreaming: boolean;
  streamingContent: string;
  streamingStatus: StreamingStatus;
  streamingStatusDetail: string | null;
  abortController: AbortController | null;

  // Actions
  setActiveConversation: (id: string | null) => void;
  setMessages: (messages: Message[]) => void;
  appendMessage: (message: Message) => void;
  setSelectedModel: (model: ModelId) => void;
  setStreaming: (streaming: boolean) => void;
  setStreamingStatus: (status: StreamingStatus, detail?: string | null) => void;
  appendStreamingContent: (chunk: string) => void;
  clearStreamingContent: () => void;
  setAbortController: (ctrl: AbortController | null) => void;
  stopStreaming: () => void;
}

export const useChatStore = create<ChatStore>((set, get) => ({
  activeConversationId: null,
  messages: [],
  selectedModel: 'gemini-3.1-pro',

  isStreaming: false,
  streamingContent: '',
  streamingStatus: 'idle',
  streamingStatusDetail: null,
  abortController: null,

  setActiveConversation: (id) => set({ activeConversationId: id }),
  setMessages: (messages) => set({ messages }),
  appendMessage: (message) =>
    set((s) => ({ messages: [...s.messages, message] })),
  setSelectedModel: (model) => set({ selectedModel: model }),
  setStreaming: (streaming) => set({ isStreaming: streaming }),
  setStreamingStatus: (status, detail) => set({ streamingStatus: status, streamingStatusDetail: detail ?? null }),
  appendStreamingContent: (chunk) =>
    set((s) => ({ streamingContent: s.streamingContent + chunk })),
  clearStreamingContent: () => set({ streamingContent: '', streamingStatus: 'idle', streamingStatusDetail: null }),
  setAbortController: (ctrl) => set({ abortController: ctrl }),
  stopStreaming: () => {
    const { abortController } = get();
    if (abortController) {
      abortController.abort();
    }
    set({ isStreaming: false, abortController: null, streamingStatus: 'idle', streamingStatusDetail: null });
  },
}));
