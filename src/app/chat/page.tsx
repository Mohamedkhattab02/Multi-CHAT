'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useChatStore } from '@/lib/store/chat-store';
import { useStreaming } from '@/lib/hooks/use-streaming';
import { EmptyState } from '@/components/chat/EmptyState';
import { ChatInput } from '@/components/chat/ChatInput';
import { StreamingMessage } from '@/components/chat/StreamingMessage';
import { useSidebarStore } from '@/lib/store/sidebar-store';
import { PanelLeft } from 'lucide-react';
import { toast } from 'sonner';
import type { ModelId } from '@/lib/utils/constants';

export default function NewChatPage() {
  const router = useRouter();
  const { selectedModel, setSelectedModel } = useChatStore();
  const { isOpen, toggle } = useSidebarStore();
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);

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

      setPendingMessage(text);

      try {
        // 1. Create a new conversation
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
          .select()
          .single();

        if (error || !conversation) {
          toast.error('Failed to create conversation');
          setPendingMessage(null);
          return;
        }

        // 2. Convert file attachments
        const serializedAttachments = await Promise.all(
          attachments.map(async (att) => {
            let data: string | undefined;
            if (att.type.startsWith('image/')) {
              data = await fileToBase64(att.file);
            }
            return { type: att.type, name: att.name, size: att.size, data };
          })
        );

        // 3. Send message via streaming
        await sendMessage({
          message: text,
          conversationId: conversation.id,
          model: selectedModel,
          attachments: serializedAttachments,
          onMessageSaved: () => {
            // Navigate to the new conversation
            router.push(`/chat/${conversation.id}`);
          },
        });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to send message');
        setPendingMessage(null);
      }
    },
    [selectedModel, sendMessage, router]
  );

  const handleSuggestionClick = useCallback(
    (text: string) => {
      handleSend(text, []);
    },
    [handleSend]
  );

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
        {isStreaming && pendingMessage ? (
          <div className="h-full flex flex-col">
            {/* Show the user's sent message */}
            <div className="flex-1 overflow-y-auto chat-scroll">
              <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
                {/* User message */}
                <div className="flex justify-end">
                  <div className="max-w-[85%] px-4 py-3 rounded-2xl bg-[var(--primary)] text-[var(--primary-foreground)] text-sm leading-relaxed rounded-br-md">
                    {pendingMessage}
                  </div>
                </div>

                {/* Streaming assistant response */}
                <StreamingMessage
                  content={streamingContent}
                  model={selectedModel}
                  routeOverride={routeOverride}
                  onStop={stopStreaming}
                />
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
