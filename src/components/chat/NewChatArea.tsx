'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useChatStore } from '@/lib/store/chat-store';
import { DEFAULT_MODEL, type ModelId } from '@/lib/utils/constants';
import { useStreaming } from '@/hooks/useStreaming';
import { getOverrideBadgeLabel } from '@/lib/ai/router';
import { ChatInput } from './ChatInput';
import { EmptyState } from './EmptyState';
import { StreamingMessage } from './StreamingMessage';
import type { PendingAttachment } from './FilePreview';

// ============================================================
// NewChatArea — the /chat page (no conversation yet)
// Shows EmptyState + ChatInput. On first send, auto-creates
// a conversation and navigates to /chat/[id].
// ============================================================

export function NewChatArea() {
  const { selectedModel, setSelectedModel, streamingContent } = useChatStore();
  const { isStreaming, streamingModel, sendMessage, stopStreaming } = useStreaming();
  const [overrideBadgeLabel, setOverrideBadgeLabel] = useState<string | null>(null);
  const router = useRouter();

  const handleSend = useCallback(
    async (message: string, attachments: PendingAttachment[]) => {
      if (!message.trim() && attachments.length === 0) return;

      // No conversationId — API will auto-create one and return it in metadata
      const metadata = await sendMessage({
        model: selectedModel,
        message,
        attachments,
      });

      if (metadata?.conversationId) {
        const badge = getOverrideBadgeLabel(metadata.override ?? undefined);
        setOverrideBadgeLabel(badge);
        // Navigate to the new conversation
        router.push(`/chat/${metadata.conversationId}`);
      }
    },
    [selectedModel, sendMessage, router]
  );

  return (
    <div className="flex flex-col h-full">
      {/* Content area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {isStreaming ? (
          <div className="flex-1 overflow-y-auto chat-scroll">
            <div className="max-w-3xl mx-auto px-4 py-6">
              <StreamingMessage content={streamingContent} model={streamingModel} />
            </div>
          </div>
        ) : (
          <div className="flex-1">
            <EmptyState
              onModelSelect={setSelectedModel}
              selectedModel={selectedModel}
            />
          </div>
        )}
      </div>

      {/* Input */}
      <ChatInput
        onSend={handleSend}
        onStop={stopStreaming}
        isStreaming={isStreaming}
        selectedModel={selectedModel}
        onModelChange={setSelectedModel}
        overrideBadge={overrideBadgeLabel}
      />
    </div>
  );
}
