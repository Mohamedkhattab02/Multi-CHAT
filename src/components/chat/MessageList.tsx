'use client';

import { useEffect, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { MessageBubble } from './MessageBubble';
import { StreamingMessage } from './StreamingMessage';
import type { Message } from '@/lib/supabase/types';

// ============================================================
// MessageList — virtual scrolling for long conversations
// Auto-scrolls to bottom on new messages
// ============================================================

interface MessageListProps {
  messages: Message[];
  streamingContent: string;
  streamingModel: string;
  isStreaming: boolean;
  onRegenerate?: (messageId: string) => void;
  onDelete?: (messageId: string) => void;
}

export function MessageList({
  messages,
  streamingContent,
  streamingModel,
  isStreaming,
  onRegenerate,
  onDelete,
}: MessageListProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);

  // Track whether user has scrolled up
  const handleScroll = () => {
    const el = parentRef.current;
    if (!el) return;
    const threshold = 100;
    isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
  };

  // Auto-scroll to bottom on new messages or streaming content
  useEffect(() => {
    if (isAtBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length, streamingContent]);

  // Virtual scroll — each row estimated at 80px, actual measured
  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 80,
    overscan: 5,
  });

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div
      ref={parentRef}
      className="flex-1 overflow-y-auto chat-scroll"
      onScroll={handleScroll}
    >
      <div className="max-w-3xl mx-auto px-4 py-6">
        {messages.length === 0 && !isStreaming && (
          <div className="text-center text-sm text-[var(--muted-foreground)] mt-16 animate-fade-in">
            <p>Start the conversation below</p>
          </div>
        )}

        {/* Virtual list container */}
        <div
          style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}
        >
          {virtualItems.map((virtualItem) => {
            const msg = messages[virtualItem.index];
            const isLastAssistant =
              msg.role === 'assistant' &&
              virtualItem.index === messages.length - 1;

            return (
              <div
                key={msg.id}
                data-index={virtualItem.index}
                ref={virtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualItem.start}px)`,
                }}
              >
                <div className="pb-5 animate-fade-in">
                  <MessageBubble
                    message={msg}
                    onRegenerate={onRegenerate}
                    onDelete={onDelete}
                    isLast={isLastAssistant}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Streaming message appears below the virtual list */}
        {isStreaming && (
          <div className="pb-5">
            <StreamingMessage
              content={streamingContent}
              model={streamingModel}
            />
          </div>
        )}

        {/* Scroll anchor */}
        <div ref={bottomRef} className="h-1" />
      </div>
    </div>
  );
}
