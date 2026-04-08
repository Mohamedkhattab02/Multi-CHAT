'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useChatStore } from '@/lib/store/chat-store';
import { useStreaming } from '@/lib/hooks/use-streaming';
import { EmptyState } from '@/components/chat/EmptyState';
import { ChatInput } from '@/components/chat/ChatInput';
import { StreamingMessage } from '@/components/chat/StreamingMessage';
import { MessageBubble } from '@/components/chat/MessageBubble';
import { useSidebarStore } from '@/lib/store/sidebar-store';
import { PanelLeft } from 'lucide-react';
import { toast } from 'sonner';
import type { ModelId } from '@/lib/utils/constants';
import type { Message } from '@/lib/supabase/types';

export default function NewChatPage() {
  const router = useRouter();
  const { selectedModel, setSelectedModel } = useChatStore();
  const { isOpen, toggle } = useSidebarStore();

  // Track the conversation created after the first message
  const conversationIdRef = useRef<string | null>(null);
  // All messages exchanged so far (kept in local state, no navigation needed)
  const [messages, setMessages] = useState<Message[]>([]);

  const {
    isStreaming,
    streamingContent,
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

      try {
        let convId = conversationIdRef.current;

        // First message — create a new conversation
        if (!convId) {
          const supabase = createClient();
          const {
            data: { user },
          } = await supabase.auth.getUser();
          if (!user) {
            toast.error('Please log in to start a conversation');
            return;
          }

          const { data: conversation, error } = await supabase
            .from('conversations')
            .insert({
              user_id: user.id,
              title: text.slice(0, 80) || 'New conversation',
              model: selectedModel,
            })
            .select('id')
            .single();

          if (error || !conversation) {
            console.error('[CreateConversation] Error:', error);
            toast.error(`Failed to create conversation: ${error?.message || 'unknown error'}`);
            return;
          }

          convId = conversation.id;
          conversationIdRef.current = convId;
          // Update URL silently — no re-render
          window.history.replaceState(null, '', `/chat/${convId}`);
        }

        // Build optimistic user message with file previews
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
          conversation_id: convId,
          role: 'user',
          content: text,
          content_blocks: null,
          model: selectedModel,
          token_count: null,
          attachments: optimisticAttachments,
          created_at: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, optimisticUserMsg]);

        // Convert files to base64
        const serializedAttachments = await Promise.all(
          attachments.map(async (att) => {
            const data = await fileToBase64(att.file);
            return { type: att.type, name: att.name, size: att.size, data };
          })
        );

        // Send via streaming
        await sendMessage({
          message: text,
          conversationId: convId,
          model: selectedModel,
          attachments: serializedAttachments,
          onMessageSaved: (_userMsg, assistantMsg) => {
            // Append the assistant response — NO navigation, NO re-render
            setMessages((prev) => [...prev, assistantMsg]);
          },
        });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to send message');
      }
    },
    [selectedModel, sendMessage]
  );

  const handleSuggestionClick = useCallback(
    (text: string) => {
      handleSend(text, []);
    },
    [handleSend]
  );

  const hasMessages = messages.length > 0;

  return (
    <div className="flex flex-col h-full">
      {/* Minimal header for mobile sidebar toggle */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--border)] bg-[var(--card)] md:hidden">
        {!isOpen && (
          <button
            onClick={toggle}
            className="p-1.5 rounded-lg hover:bg-[var(--secondary)] transition-colors cursor-pointer"
          >
            <PanelLeft className="w-4.5 h-4.5 text-[var(--muted-foreground)]" />
          </button>
        )}
        <span className="text-sm font-medium text-[var(--foreground)]">New chat</span>
      </div>

      {/* Main area */}
      <div className="flex-1 overflow-hidden">
        {hasMessages || isStreaming ? (
          <div className="h-full flex flex-col">
            <div className="flex-1 overflow-y-auto chat-scroll">
              <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
                {/* Render all messages using the real MessageBubble */}
                {messages.map((msg) => (
                  <MessageBubble key={msg.id} message={msg} />
                ))}

                {/* Streaming assistant response */}
                {isStreaming && (
                  <StreamingMessage
                    content={streamingContent}
                    model={selectedModel}
                    routeOverride={routeOverride}
                    onStop={stopStreaming}
                  />
                )}
              </div>
            </div>
          </div>
        ) : (
          <EmptyState onSuggestionClick={handleSuggestionClick} />
        )}
      </div>

      {/* Chat input */}
      <ChatInput
        selectedModel={selectedModel}
        onModelChange={setSelectedModel as (model: ModelId) => void}
        onSend={handleSend}
        isStreaming={isStreaming}
      />
    </div>
  );
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
