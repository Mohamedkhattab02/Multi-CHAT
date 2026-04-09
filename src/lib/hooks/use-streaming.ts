'use client';

import { useCallback, useRef } from 'react';
import { useChatStore } from '@/lib/store/chat-store';
import type { ModelId } from '@/lib/utils/constants';
import type { Message } from '@/lib/supabase/types';

interface SendMessageParams {
  message: string;
  conversationId: string;
  model: ModelId;
  attachments?: Array<{
    url?: string;
    storagePath?: string;
    extractedText?: string;
    type: string;
    name: string;
    size: number;
    data?: string;
  }>;
  onMessageSaved?: (userMessage: Message, assistantMessage: Message) => void;
}

export function useStreaming() {
  const routeOverrideRef = useRef<string | null>(null);

  const {
    isStreaming,
    streamingContent,
    setStreaming,
    appendStreamingContent,
    clearStreamingContent,
    setAbortController,
    stopStreaming,
  } = useChatStore();

  const sendMessage = useCallback(
    async ({ message, conversationId, model, attachments, onMessageSaved }: SendMessageParams) => {
      // Reset state
      clearStreamingContent();
      routeOverrideRef.current = null;
      setStreaming(true);

      const abortController = new AbortController();
      setAbortController(abortController);

      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message,
            conversationId,
            model,
            attachments: attachments || [],
          }),
          signal: abortController.signal,
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error || `Error: ${response.status}`);
        }

        const contentType = response.headers.get('content-type');

        // Handle image generation (non-SSE JSON response)
        if (contentType?.includes('application/json')) {
          const data = await response.json();
          if (data.type === 'image') {
            // Create synthetic messages for the UI
            const userMsg: Message = {
              id: crypto.randomUUID(),
              conversation_id: conversationId,
              role: 'user',
              content: message,
              content_blocks: null,
              model: 'gemini-3.1-flash-image',
              token_count: null,
              attachments: [],
              created_at: new Date().toISOString(),
            };
            const assistantMsg: Message = {
              id: crypto.randomUUID(),
              conversation_id: conversationId,
              role: 'assistant',
              content: data.text,
              content_blocks: null,
              model: 'gemini-3.1-flash-image',
              token_count: null,
              attachments: [
                {
                  type: data.mimeType,
                  data: data.image,
                  name: 'generated-image.png',
                },
              ],
              created_at: new Date().toISOString(),
            };
            onMessageSaved?.(userMsg, assistantMsg);
            setStreaming(false);
            return;
          }
          throw new Error(data.error || 'Unexpected response');
        }

        // Handle SSE streaming
        if (!response.body) throw new Error('No response body');

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let fullText = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();

            // Skip heartbeat comments
            if (trimmed.startsWith(':')) continue;
            if (!trimmed.startsWith('data:')) continue;

            const data = trimmed.slice(5).trim();
            if (!data) continue;

            try {
              const parsed = JSON.parse(data);

              if (parsed.routeOverride) {
                routeOverrideRef.current = parsed.routeOverride;
              }

              if (parsed.text) {
                fullText += parsed.text;
                appendStreamingContent(parsed.text);
              }

              if (parsed.done) {
                // Stream complete — create synthetic messages for immediate UI update
                // Map attachments to include preview URLs for display
                const displayAttachments = (attachments || []).map(a => ({
                  type: a.type,
                  name: a.name,
                  size: a.size,
                  url: a.url,
                  // For images, create data URL for immediate preview if no storage URL
                  ...(a.type.startsWith('image/') && a.data && !a.url
                    ? { data: a.data }
                    : {}),
                }));
                const userMsg: Message = {
                  id: crypto.randomUUID(),
                  conversation_id: conversationId,
                  role: 'user',
                  content: message,
                  content_blocks: null,
                  model,
                  token_count: null,
                  attachments: displayAttachments,
                  created_at: new Date().toISOString(),
                };
                const assistantMsg: Message = {
                  id: crypto.randomUUID(),
                  conversation_id: conversationId,
                  role: 'assistant',
                  content: fullText,
                  content_blocks: null,
                  model: routeOverrideRef.current || model,
                  token_count: null,
                  attachments: [],
                  created_at: new Date().toISOString(),
                };
                onMessageSaved?.(userMsg, assistantMsg);
              }

              if (parsed.error) {
                throw new Error(parsed.error);
              }
            } catch (e) {
              if (e instanceof SyntaxError) continue;
              throw e;
            }
          }
        }
      } catch (error) {
        if ((error as Error).name === 'AbortError') {
          // User cancelled
        } else {
          console.error('[useStreaming] Error:', error);
          throw error;
        }
      } finally {
        setStreaming(false);
        setAbortController(null);
      }
    },
    [
      clearStreamingContent,
      setStreaming,
      setAbortController,
      appendStreamingContent,
    ]
  );

  return {
    isStreaming,
    streamingContent,
    routeOverride: routeOverrideRef.current,
    sendMessage,
    stopStreaming,
  };
}
