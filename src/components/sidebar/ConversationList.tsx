'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useSidebarStore } from '@/lib/store/sidebar-store';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Conversation } from '@/lib/supabase/types';
import { formatRelativeTime } from '@/lib/utils/format';

const MODEL_COLORS: Record<string, string> = {
  'gpt-5.1': '#10B981',
  'gpt-5-mini': '#10B981',
  'gemini-3.1-pro': '#3B82F6',
  'gemini-3-flash': '#3B82F6',
  'glm-5': '#7C3AED',
};

interface ConversationListProps {
  userId: string;
}

export function ConversationList({ userId }: ConversationListProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const { searchQuery } = useSidebarStore();
  const pathname = usePathname();
  const supabase = createClient();

  useEffect(() => {
    supabase
      .from('conversations')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(100)
      .then(({ data }) => {
        if (data) setConversations(data);
      });

    // Realtime subscription for updates
    const channel = supabase
      .channel('conversations')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversations', filter: `user_id=eq.${userId}` },
        () => {
          supabase
            .from('conversations')
            .select('*')
            .eq('user_id', userId)
            .order('updated_at', { ascending: false })
            .limit(100)
            .then(({ data }) => { if (data) setConversations(data); });
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [userId]);

  const filtered = searchQuery
    ? conversations.filter((c) =>
        c.title.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : conversations;

  if (filtered.length === 0) {
    return (
      <div className="px-3 py-6 text-center text-xs text-[var(--muted-foreground)]">
        {searchQuery ? 'No conversations found' : 'No conversations yet'}
      </div>
    );
  }

  return (
    <div className="overflow-y-auto chat-scroll h-full py-1">
      {filtered.map((conv) => {
        const isActive = pathname === `/chat/${conv.id}`;
        const color = MODEL_COLORS[conv.model] ?? '#737373';
        return (
          <Link
            key={conv.id}
            href={`/chat/${conv.id}`}
            className={`flex items-center gap-2.5 mx-1 px-2.5 py-2 rounded-lg text-sm transition-colors group ${
              isActive
                ? 'bg-[var(--accent)] text-[var(--foreground)]'
                : 'text-[var(--foreground)] hover:bg-[var(--secondary)]'
            }`}
          >
            {/* Model color dot */}
            <span
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: color }}
            />
            <span className="flex-1 truncate text-xs font-medium">{conv.title}</span>
            <span className="text-[10px] text-[var(--muted-foreground)] flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
              {formatRelativeTime(new Date(conv.updated_at))}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
