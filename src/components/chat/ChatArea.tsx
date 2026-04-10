'use client';

import { useCallback, useEffect } from 'react';
import { type Conversation, type Message } from '@/lib/supabase/types';
import { MODELS, type ModelId } from '@/lib/utils/constants';
import { useSidebarStore } from '@/lib/store/sidebar-store';
import { useChatStore } from '@/lib/store/chat-store';
import { useUiStore } from '@/lib/store/ui-store';
import { useMessages } from '@/lib/hooks/use-messages';
import { useStreaming } from '@/lib/hooks/use-streaming';
import { MessageList } from './MessageList';
import { ChatInput } from './ChatInput';
import { EmptyState } from './EmptyState';
import { ChatHeaderMenu } from './ChatHeaderMenu';
import { PanelLeft, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { uploadFile } from '@/lib/utils/upload-file';

interface ChatAreaProps {
  conversation: Conversation;
  initialMessages: Message[];
  userId: string;
}

export function ChatArea({ conversation, initialMessages, userId }: ChatAreaProps) {
  const { isOpen, toggle } = useSidebarStore();
  const { selectedModel, setSelectedModel, setActiveConversation } = useChatStore();
  const { setShareDialogOpen } = useUiStore();

  const model = MODELS[conversation.model as ModelId];
  const modelColor = model?.color ?? '#737373';

  // Initialize from conversation
  useEffect(() => {
    setActiveConversation(conversation.id);
    setSelectedModel(conversation.model as ModelId);
  }, [conversation.id, conversation.model, setActiveConversation, setSelectedModel]);

  // Messages from react-query (uses initialMessages as seed, then syncs with DB)
  const {
    messages,
    addMessages,
    deleteMessage: handleDeleteMessage,
    refetch: refetchMessages,
  } = useMessages(conversation.id);

  // Use initial messages until react-query hydrates
  const displayMessages = messages.length > 0 ? messages : initialMessages;

  // Streaming
  const {
    isStreaming,
    streamingContent,
    streamingStatus,
    streamingStatusDetail,
    routeOverride,
    sendMessage,
    stopStreaming,
  } = useStreaming();

  const handleSend = useCallback(
    async (
      text: string,
      attachments: Array<{ file: File; type: string; name: string; size: number }>
    ) => {
      if (!text.trim() && attachments.length === 0) return;

      // IMMEDIATELY show user message (optimistic) — before any upload
      const optimisticAttachments = attachments.map((att) => ({
        type: att.type,
        name: att.name,
        size: att.size,
        ...(att.type.startsWith('image/')
          ? { url: URL.createObjectURL(att.file) }
          : {}),
      }));
      const optimisticUserMsg: Message = {
        id: `optimistic-${Date.now()}`,
        conversation_id: conversation.id,
        role: 'user',
        content: text,
        content_blocks: null,
        model: selectedModel,
        token_count: null,
        attachments: optimisticAttachments,
        created_at: new Date().toISOString(),
      };
      addMessages([optimisticUserMsg]);

      try {
        // Upload files to Supabase Storage (fast — no text extraction)
        // Text extraction happens server-side in /api/chat
        const serializedAttachments = await Promise.all(
          attachments.map(async (att) => {
            const uploaded = await uploadFile(att.file);
            return {
              type: att.type,
              name: att.name,
              size: att.size,
              url: uploaded.url,
              storagePath: uploaded.storagePath,
            };
          })
        );

        await sendMessage({
          message: text,
          conversationId: conversation.id,
          model: selectedModel,
          attachments: serializedAttachments,
          onMessageSaved: (_userMsg, assistantMsg) => {
            // Only add assistant message — user message was already added optimistically
            addMessages([assistantMsg]);
            // Refetch from DB to get real IDs and sync state
            setTimeout(() => refetchMessages(), 500);
          },
        });
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : 'Failed to send message'
        );
      }
    },
    [conversation.id, selectedModel, sendMessage, addMessages, refetchMessages]
  );

  const handleRegenerate = useCallback(
    async (messageId: string) => {
      // Find the last user message before this assistant message
      const msgIndex = displayMessages.findIndex((m) => m.id === messageId);
      if (msgIndex <= 0) return;

      const userMsg = displayMessages
        .slice(0, msgIndex)
        .reverse()
        .find((m) => m.role === 'user');
      if (!userMsg) return;

      // Delete the old assistant message and resend
      handleDeleteMessage(messageId);
      await handleSend(userMsg.content, []);
    },
    [displayMessages, handleDeleteMessage, handleSend]
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--border)] bg-[var(--card)]">
        {!isOpen && (
          <button
            onClick={toggle}
            className="p-1.5 rounded-lg hover:bg-[var(--secondary)] transition-colors cursor-pointer md:hidden"
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
            onClick={() => setShareDialogOpen(true, conversation.id)}
            className="p-1.5 rounded-lg hover:bg-[var(--secondary)] transition-colors cursor-pointer"
            title="Share"
          >
            <Share2 className="w-4 h-4 text-[var(--muted-foreground)]" />
          </button>
          <ChatHeaderMenu conversationId={conversation.id} title={conversation.title} />
        </div>
      </div>

      {/* Messages area */}
      {displayMessages.length === 0 && !isStreaming ? (
        <EmptyState />
      ) : (
        <MessageList
          messages={displayMessages}
          isStreaming={isStreaming}
          streamingContent={streamingContent}
          streamingModel={selectedModel}
          routeOverride={routeOverride}
          streamingStatus={streamingStatus}
          streamingStatusDetail={streamingStatusDetail}
          onStopStreaming={stopStreaming}
          onRegenerate={handleRegenerate}
          onDelete={handleDeleteMessage}
        />
      )}

      {/* Chat input */}
      <ChatInput
        selectedModel={selectedModel}
        onModelChange={setSelectedModel}
        onSend={handleSend}
        isStreaming={isStreaming}
      />
    </div>
  );
}
