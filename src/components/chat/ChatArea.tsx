'use client';

import { type Conversation, type Message } from '@/lib/supabase/types';

interface ChatAreaProps {
  conversation: Conversation;
  initialMessages: Message[];
  userId: string;
}

// Stub — full implementation in Phase 2
export function ChatArea({ conversation, initialMessages, userId }: ChatAreaProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border)]">
        <h1 className="text-sm font-medium text-[var(--foreground)] truncate flex-1">
          {conversation.title}
        </h1>
        <span className="text-xs text-[var(--muted-foreground)] bg-[var(--secondary)] px-2 py-0.5 rounded-full">
          {conversation.model}
        </span>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto chat-scroll p-4 space-y-4">
        {initialMessages.length === 0 && (
          <div className="text-center text-sm text-[var(--muted-foreground)] mt-8">
            Start the conversation below
          </div>
        )}
        {initialMessages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm ${
                msg.role === 'user'
                  ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
                  : 'bg-[var(--secondary)] text-[var(--foreground)]'
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}
      </div>

      {/* Input placeholder */}
      <div className="px-4 py-3 border-t border-[var(--border)]">
        <div className="flex items-center gap-2 p-3 border border-[var(--border)] rounded-xl bg-[var(--background)] text-sm text-[var(--muted-foreground)]">
          Message MultiChat AI... (full input coming in Phase 2)
        </div>
      </div>
    </div>
  );
}
