'use client';

import { type Conversation, type Message } from '@/lib/supabase/types';
import { MODELS, type ModelId } from '@/lib/utils/constants';
import { useSidebarStore } from '@/lib/store/sidebar-store';
import { PanelLeft, Share2, MoreHorizontal } from 'lucide-react';

interface ChatAreaProps {
  conversation: Conversation;
  initialMessages: Message[];
  userId: string;
}

export function ChatArea({ conversation, initialMessages }: ChatAreaProps) {
  const { isOpen, toggle } = useSidebarStore();
  const model = MODELS[conversation.model as ModelId];
  const modelColor = model?.color ?? '#737373';

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
            className="p-1.5 rounded-lg hover:bg-[var(--secondary)] transition-colors cursor-pointer"
            title="Share"
          >
            <Share2 className="w-4 h-4 text-[var(--muted-foreground)]" />
          </button>
          <button
            className="p-1.5 rounded-lg hover:bg-[var(--secondary)] transition-colors cursor-pointer"
            title="More options"
          >
            <MoreHorizontal className="w-4 h-4 text-[var(--muted-foreground)]" />
          </button>
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto chat-scroll">
        <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
          {initialMessages.length === 0 && (
            <div className="text-center text-sm text-[var(--muted-foreground)] mt-12 animate-fade-in">
              <p>Start the conversation below</p>
            </div>
          )}
          {initialMessages.map((msg, i) => (
            <div
              key={msg.id}
              className="animate-fade-in"
              style={{ animationDelay: `${Math.min(i * 30, 300)}ms` }}
            >
              {msg.role === 'user' ? (
                <div className="flex justify-end">
                  <div className="max-w-[80%] rounded-2xl rounded-br-md px-4 py-3 text-sm bg-[var(--primary)] text-[var(--primary-foreground)] leading-relaxed">
                    {msg.content}
                  </div>
                </div>
              ) : (
                <div className="flex gap-3">
                  <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 text-white text-[10px] font-bold"
                    style={{ backgroundColor: modelColor }}
                  >
                    {(model?.shortName ?? 'AI').charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="rounded-2xl rounded-tl-md px-4 py-3 text-sm bg-[var(--secondary)] text-[var(--foreground)] leading-relaxed">
                      {msg.content}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Input placeholder */}
      <div className="border-t border-[var(--border)] bg-[var(--card)]">
        <div className="max-w-3xl mx-auto px-4 py-3">
          <div className="flex items-center gap-3 p-3.5 border border-[var(--border)] rounded-xl bg-[var(--background)] text-sm text-[var(--muted-foreground)] transition-all duration-200 hover:border-[var(--ring)]/30">
            <span className="flex-1">Message MultiChat AI...</span>
            <span
              className="text-[10px] font-semibold px-2 py-0.5 rounded-full text-white"
              style={{ backgroundColor: modelColor }}
            >
              {model?.shortName ?? conversation.model}
            </span>
          </div>
          <p className="text-center text-[10px] text-[var(--muted-foreground)] mt-2">
            Full chat input coming in Phase 2 — Tiptap editor, voice input, file attachments
          </p>
        </div>
      </div>
    </div>
  );
}
