'use client';

import { useRef, useEffect, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { MessageBubble } from './MessageBubble';
import { StreamingMessage } from './StreamingMessage';
import type { Message } from '@/lib/supabase/types';

interface MessageListProps {
  messages: Message[];
  isStreaming: boolean;
  streamingContent: string;
  streamingModel: string;
  routeOverride?: string | null;
  onStopStreaming: () => void;
  onRegenerate?: (messageId: string) => void;
  onDelete?: (messageId: string) => void;
}

export function MessageList({
  messages,
  isStreaming,
  streamingContent,
  streamingModel,
  routeOverride,
  onStopStreaming,
  onRegenerate,
  onDelete,
}: MessageListProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const isAutoScrollRef = useRef(true);

  // Total items = messages + 1 streaming row (if active)
  const totalItems = messages.length + (isStreaming ? 1 : 0);

  const virtualizer = useVirtualizer({
    count: totalItems,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 120, // estimated row height
    overscan: 5,
  });

  // Auto-scroll to bottom on new messages / streaming
  const scrollToBottom = useCallback(() => {
    if (!isAutoScrollRef.current) return;
    virtualizer.scrollToIndex(totalItems - 1, { align: 'end', behavior: 'smooth' });
  }, [virtualizer, totalItems]);

  useEffect(() => {
    scrollToBottom();
  }, [messages.length, streamingContent, scrollToBottom]);

  // Detect if user scrolled up (disable auto-scroll)
  const handleScroll = useCallback(() => {
    const el = parentRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    isAutoScrollRef.current = atBottom;
  }, []);

  return (
    <div
      ref={parentRef}
      className="flex-1 overflow-y-auto chat-scroll"
      onScroll={handleScroll}
    >
      <div
        className="relative w-full"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        <div className="max-w-3xl mx-auto px-4">
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const isStreamingRow =
              isStreaming && virtualItem.index === messages.length;

            return (
              <div
                key={virtualItem.key}
                data-index={virtualItem.index}
                ref={virtualizer.measureElement}
                className="py-2.5"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  transform: `translateY(${virtualItem.start}px)`,
                }}
              >
                <div className="max-w-3xl mx-auto px-4">
                  {isStreamingRow ? (
                    <StreamingMessage
                      content={streamingContent}
                      model={streamingModel}
                      routeOverride={routeOverride}
                      onStop={onStopStreaming}
                    />
                  ) : (
                    <MessageBubble
                      message={messages[virtualItem.index]}
                      onRegenerate={
                        messages[virtualItem.index].role === 'assistant'
                          ? onRegenerate
                          : undefined
                      }
                      onDelete={onDelete}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
