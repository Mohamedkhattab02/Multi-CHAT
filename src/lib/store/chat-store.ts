import { create } from 'zustand';
import type { Message } from '@/lib/supabase/types';

type ModelId = 'gpt-5.1' | 'gpt-5-mini' | 'gemini-3.1-pro' | 'gemini-3-flash' | 'gemini-3.1-flash-image' | 'glm-5';

interface ChatStore {
  // Active conversation
  activeConversationId: string | null;
  messages: Message[];
  selectedModel: ModelId;

  // Streaming state
  isStreaming: boolean;
  streamingContent: string;
  abortController: AbortController | null;

  // Actions
  setActiveConversation: (id: string | null) => void;
  setMessages: (messages: Message[]) => void;
  appendMessage: (message: Message) => void;
  setSelectedModel: (model: ModelId) => void;
  setStreaming: (streaming: boolean) => void;
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
  abortController: null,

  setActiveConversation: (id) => set({ activeConversationId: id }),
  setMessages: (messages) => set({ messages }),
  appendMessage: (message) =>
    set((s) => ({ messages: [...s.messages, message] })),
  setSelectedModel: (model) => set({ selectedModel: model }),
  setStreaming: (streaming) => set({ isStreaming: streaming }),
  appendStreamingContent: (chunk) =>
    set((s) => ({ streamingContent: s.streamingContent + chunk })),
  clearStreamingContent: () => set({ streamingContent: '' }),
  setAbortController: (ctrl) => set({ abortController: ctrl }),
  stopStreaming: () => {
    const { abortController } = get();
    if (abortController) {
      abortController.abort();
    }
    set({ isStreaming: false, abortController: null });
  },
}));
