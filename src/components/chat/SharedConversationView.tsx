'use client';

import type { Conversation, Message } from '@/lib/supabase/types';
import { MODELS, type ModelId } from '@/lib/utils/constants';
import { formatDate, formatTime } from '@/lib/utils/format';
import { MessageSquare, Globe } from 'lucide-react';

interface Props {
  conversation: Conversation;
  messages: Message[];
}

export function SharedConversationView({ conversation, messages }: Props) {
  const model = MODELS[conversation.model as ModelId];
  const modelColor = model?.color ?? '#737373';

  return (
    <div className="min-h-screen bg-[var(--background)]">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--card)] backdrop-blur-sm">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-[var(--primary)]" />
            <span className="font-semibold text-sm text-[var(--foreground)]">MultiChat AI</span>
          </div>
          <span className="text-[var(--border)]">|</span>
          <span className="text-sm text-[var(--foreground)] truncate flex-1">{conversation.title}</span>
          <span
            className="text-[10px] font-semibold px-2.5 py-1 rounded-full text-white flex-shrink-0"
            style={{ backgroundColor: modelColor }}
          >
            {model?.shortName ?? conversation.model}
          </span>
        </div>
      </header>

      {/* Shared badge */}
      <div className="max-w-3xl mx-auto px-4 pt-4">
        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--secondary)] text-[10px] font-medium text-[var(--muted-foreground)]">
          <Globe className="w-3 h-3" />
          Shared conversation — read-only
        </div>
      </div>

      {/* Messages */}
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
        {messages.map((msg) => (
          <div key={msg.id}>
            {msg.role === 'user' ? (
              <div className="flex justify-end">
                <div className="max-w-[80%]">
                  <div className="rounded-2xl rounded-br-md px-4 py-3 text-sm bg-[var(--primary)] text-[var(--primary-foreground)] leading-relaxed">
                    {msg.content}
                  </div>
                  <p className="text-right text-[10px] text-[var(--muted-foreground)] mt-1 pr-1">
                    {formatDate(msg.created_at)} {formatTime(msg.created_at)}
                  </p>
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
                  <p className="text-[10px] text-[var(--muted-foreground)] mt-1 pl-1">
                    {formatDate(msg.created_at)} {formatTime(msg.created_at)}
                  </p>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Footer */}
      <footer className="border-t border-[var(--border)] bg-[var(--card)]">
        <div className="max-w-3xl mx-auto px-4 py-4 text-center text-xs text-[var(--muted-foreground)]">
          Shared via <span className="font-semibold gradient-text">MultiChat AI</span>
        </div>
      </footer>
    </div>
  );
}
