'use client';

import { useCallback } from 'react';
import { useChatStore } from '@/lib/store/chat-store';
import { toast } from 'sonner';
import type { PendingAttachment } from '@/components/chat/FilePreview';
import type { ModelId } from '@/lib/utils/constants';

// ============================================================
// useStreaming — SSE streaming hook
// Calls /api/chat and reads SSE chunks
// Manages AbortController for cancellation
// ============================================================

interface StreamOptions {
  conversationId?: string;
  model: ModelId;
  message: string;
  attachments?: PendingAttachment[];
}

interface StreamMetadata {
  model: string;
  override: string | null;
  conversationId: string | null;
}

interface UseStreamingReturn {
  isStreaming: boolean;
  streamingContent: string;
  streamingModel: string;
  overrideBadge: string | null;
  sendMessage: (opts: StreamOptions) => Promise<StreamMetadata | null>;
  stopStreaming: () => void;
}

export function useStreaming(): UseStreamingReturn {
  const {
    isStreaming,
    streamingContent,
    setStreaming,
    appendStreamingContent,
    clearStreamingContent,
    setAbortController,
    stopStreaming: stopStore,
    appendMessage,
    selectedModel,
  } = useChatStore();

  // We store the active model so the streaming message knows which avatar to show
  const streamingModelRef = { current: selectedModel };

  const stopStreaming = useCallback(() => {
    stopStore();
  }, [stopStore]);

  const sendMessage = useCallback(async (opts: StreamOptions): Promise<StreamMetadata | null> => {
    const { conversationId, model, message, attachments = [] } = opts;

    const ctrl = new AbortController();
    setAbortController(ctrl);
    setStreaming(true);
    clearStreamingContent();

    streamingModelRef.current = model;

    let metadata: StreamMetadata = { model, override: null, conversationId: conversationId ?? null };

    try {
      // Build form-compatible attachments (upload files first if needed)
      // For Phase 2 we send pre-uploaded attachment metadata only
      const attachmentData = attachments.map((a) => ({
        url: a.previewUrl ?? '',
        type: a.type,
        name: a.file.name,
        size: a.file.size,
      }));

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId,
          message,
          model,
          attachments: attachmentData,
        }),
        signal: ctrl.signal,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(err.error ?? `HTTP ${response.status}`);
      }

      if (!response.body) throw new Error('No response body');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(': ')) continue;

          const dataStr = trimmed.startsWith('data: ') ? trimmed.slice(6) : trimmed;
          if (dataStr === '[DONE]') continue;

          try {
            const event = JSON.parse(dataStr);

            if (event.error) {
              toast.error(event.error);
              break;
            }

            // First metadata event
            if (event.model && !event.text && !event.imageUrl) {
              metadata = {
                model: event.model,
                override: event.override ?? null,
                conversationId: event.conversationId ?? conversationId ?? null,
              };
              continue;
            }

            // Image generation result
            if (event.imageUrl) {
              const imageMarkdown = `![Generated Image](${event.imageUrl})`;
              fullContent += imageMarkdown;
              appendStreamingContent(imageMarkdown);
              continue;
            }

            // Regular text chunk
            if (event.text) {
              fullContent += event.text;
              appendStreamingContent(event.text);
            }
          } catch {
            // Skip malformed events
          }
        }
      }

      // Streaming complete — the server already saved the assistant message to DB
      // We just need to update local state to show it immediately without a refetch
      setStreaming(false);
      clearStreamingContent();

      return metadata;
    } catch (err) {
      const error = err as Error;

      if (error.name !== 'AbortError') {
        console.error('[useStreaming] Error:', error);
        toast.error(error.message ?? 'Failed to send message');
      }

      setStreaming(false);
      clearStreamingContent();
      return null;
    } finally {
      setAbortController(null);
    }
  }, [
    setAbortController,
    setStreaming,
    clearStreamingContent,
    appendStreamingContent,
    appendMessage,
    selectedModel,
  ]);

  return {
    isStreaming,
    streamingContent,
    streamingModel: streamingModelRef.current,
    overrideBadge: null,
    sendMessage,
    stopStreaming,
  };
}
