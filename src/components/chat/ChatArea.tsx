'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { PanelLeft, Share2, MoreHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { useSidebarStore } from '@/lib/store/sidebar-store';
import { useChatStore } from '@/lib/store/chat-store';
import { MODELS, DEFAULT_MODEL, type ModelId } from '@/lib/utils/constants';
import { getOverrideBadgeLabel } from '@/lib/ai/router';
import { useStreaming } from '@/hooks/useStreaming';
import { ChatInput } from './ChatInput';
import { MessageList } from './MessageList';
import { EmptyState } from './EmptyState';
import { deleteMessage } from '@/actions/messages';
import type { Conversation, Message } from '@/lib/supabase/types';
import type { PendingAttachment } from './FilePreview';

// ============================================================
// ChatArea — main chat container
// Orchestrates MessageList + ChatInput + streaming
// ============================================================

interface ChatAreaProps {
  conversation: Conversation;
  initialMessages: Message[];
  userId: string;
}

export function ChatArea({ conversation, initialMessages, userId }: ChatAreaProps) {
  const { isOpen, toggle } = useSidebarStore();
  const {
    messages,
    setMessages,
    appendMessage,
    selectedModel,
    setSelectedModel,
    setActiveConversation,
    streamingContent,
  } = useChatStore();

  const router = useRouter();

  const { isStreaming, streamingModel, overrideBadge, sendMessage, stopStreaming } = useStreaming();

  const [overrideBadgeLabel, setOverrideBadgeLabel] = useState<string | null>(null);

  const model = MODELS[conversation.model as ModelId];
  const modelColor = model?.color ?? '#737373';

  // Track the count of server messages to detect when router.refresh() brings new data
  const serverMessageCount = initialMessages.length;

  // Initialize store with server-loaded data.
  // Re-sync when: conversation changes OR server has more messages than store (after refresh).
  useEffect(() => {
    setActiveConversation(conversation.id);
    setSelectedModel((conversation.model as ModelId) ?? DEFAULT_MODEL);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.id]);

  useEffect(() => {
    // Only overwrite store if server has more messages than what we have locally
    // This prevents re-running on every render while still catching post-stream refreshes
    setMessages(initialMessages);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.id, serverMessageCount]);

  const handleSend = useCallback(
    async (message: string, attachments: PendingAttachment[]) => {
      if (!message.trim() && attachments.length === 0) return;

      // Optimistically add user message to local state
      const tempUserMsg: Message = {
        id: `temp-${Date.now()}`,
        conversation_id: conversation.id,
        role: 'user',
        content: message,
        model: null,
        token_count: null,
        content_blocks: null,
        attachments: attachments.map((a) => ({
          url: a.previewUrl ?? '',
          type: a.type,
          name: a.file.name,
          size: a.file.size,
        })) as never,
        created_at: new Date().toISOString(),
      };
      appendMessage(tempUserMsg);

      // Stream the response
      const metadata = await sendMessage({
        conversationId: conversation.id,
        model: selectedModel,
        message,
        attachments,
      });

      if (metadata) {
        // Update override badge
        const badge = getOverrideBadgeLabel(metadata.override ?? undefined);
        setOverrideBadgeLabel(badge);

        // If a new conversation was auto-created, navigate to it
        if (!conversation.id && metadata.conversationId) {
          router.push(`/chat/${metadata.conversationId}`);
          return;
        }

        // Reload messages from server to get the actual saved messages with IDs
        router.refresh();
      }
    },
    [conversation.id, selectedModel, appendMessage, sendMessage, router]
  );

  const handleDelete = useCallback(
    async (messageId: string) => {
      // Optimistic delete from local state
      const updatedMessages = messages.filter((m) => m.id !== messageId);
      setMessages(updatedMessages);

      const { error } = await deleteMessage(messageId);
      if (error) {
        toast.error('Failed to delete message');
        setMessages(messages); // rollback
      }
    },
    [messages, setMessages]
  );

  const handleRegenerate = useCallback(
    async (messageId: string) => {
      // Find the last user message before this assistant message
      const msgIndex = messages.findIndex((m) => m.id === messageId);
      if (msgIndex === -1) return;

      const lastUserMsg = [...messages].slice(0, msgIndex).reverse().find((m) => m.role === 'user');
      if (!lastUserMsg) return;

      // Remove the assistant message and re-send
      setMessages(messages.filter((m) => m.id !== messageId));
      await handleSend(lastUserMsg.content, []);
    },
    [messages, setMessages, handleSend]
  );

  const displayMessages = messages;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--border)] bg-[var(--card)] flex-shrink-0">
        {!isOpen && (
          <button
            onClick={toggle}
            className="p-1.5 rounded-lg hover:bg-[var(--secondary)] transition-colors cursor-pointer"
            title="Toggle sidebar"
          >
            <PanelLeft className="w-4.5 h-4.5 text-[var(--muted-foreground)]" />
          </button>
        )}
        <h1 className="text-sm font-medium text-[var(--foreground)] truncate flex-1">
          {conversation.title}
        </h1>
        <span
          className="text-[10px] font-semibold px-2.5 py-1 rounded-full text-white flex-shrink-0"
          style={{ backgroundColor: modelColor }}
        >
          {model?.shortName ?? conversation.model}
        </span>
        <div className="flex items-center gap-1">
          <button
            className="p-1.5 rounded-lg hover:bg-[var(--secondary)] transition-colors"
            title="Share"
          >
            <Share2 className="w-4 h-4 text-[var(--muted-foreground)]" />
          </button>
          <button
            className="p-1.5 rounded-lg hover:bg-[var(--secondary)] transition-colors"
            title="More options"
          >
            <MoreHorizontal className="w-4 h-4 text-[var(--muted-foreground)]" />
          </button>
        </div>
      </div>

      {/* Messages */}
      {displayMessages.length === 0 && !isStreaming ? (
        <EmptyState onModelSelect={setSelectedModel} selectedModel={selectedModel} />
      ) : (
        <MessageList
          messages={displayMessages}
          streamingContent={streamingContent}
          streamingModel={streamingModel}
          isStreaming={isStreaming}
          onRegenerate={handleRegenerate}
          onDelete={handleDelete}
        />
      )}

      {/* Chat input */}
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
