'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useSidebarStore } from '@/lib/store/sidebar-store';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MessageSquare } from 'lucide-react';
import type { Conversation } from '@/lib/supabase/types';
import { formatRelativeTime, groupByDate } from '@/lib/utils/format';

const MODEL_COLORS: Record<string, string> = {
  'gpt-5.1': 'var(--model-gpt)',
  'gpt-5-mini': 'var(--model-gpt)',
  'gemini-3.1-pro': 'var(--model-gemini)',
  'gemini-3-flash': 'var(--model-gemini)',
  'glm-4.7': 'var(--model-glm)',
  'glm-4.6': 'var(--model-glm)',
};

interface ConversationListProps {
  userId: string;
}

export function ConversationList({ userId }: ConversationListProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const { searchQuery } = useSidebarStore();
  const pathname = usePathname();

  const fetchConversations = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from('conversations')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(100);

    if (data) setConversations(data);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    fetchConversations();

    const supabase = createClient();
    const channel = supabase
      .channel(`conversations-${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversations', filter: `user_id=eq.${userId}` },
        () => { fetchConversations(); }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [userId, fetchConversations]);

  const filtered = useMemo(() => {
    if (!searchQuery) return conversations;
    const q = searchQuery.toLowerCase();
    return conversations.filter((c) => c.title.toLowerCase().includes(q));
  }, [conversations, searchQuery]);

  const grouped = useMemo(() => {
    return groupByDate(filtered, (c) => new Date(c.updated_at));
  }, [filtered]);

  if (loading) {
    return (
      <div className="px-3 py-4 space-y-2">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-9 rounded-lg animate-shimmer" />
        ))}
      </div>
    );
  }

  if (filtered.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-3 py-8 text-center">
        <MessageSquare className="w-8 h-8 text-[var(--muted-foreground)] opacity-40 mb-2" />
        <p className="text-xs text-[var(--muted-foreground)]">
          {searchQuery ? 'No conversations found' : 'No conversations yet'}
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-y-auto chat-scroll h-full py-1 px-2">
      {grouped.map(({ label, items }) => (
        <div key={label} className="mb-3">
          <p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
            {label}
          </p>
          {items.map((conv) => {
            const isActive = pathname === `/chat/${conv.id}`;
            const color = MODEL_COLORS[conv.model] ?? 'var(--muted-foreground)';
            return (
              <Link
                key={conv.id}
                href={`/chat/${conv.id}`}
                className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-all duration-150 group ${
                  isActive
                    ? 'bg-[var(--sidebar-active)] text-[var(--foreground)]'
                    : 'text-[var(--foreground)] hover:bg-[var(--sidebar-hover)]'
                }`}
              >
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0 transition-transform duration-150 group-hover:scale-125"
                  style={{ backgroundColor: color }}
                />
                <span className="flex-1 truncate text-xs font-medium">{conv.title}</span>
                <span className="text-[10px] text-[var(--muted-foreground)] flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                  {formatRelativeTime(new Date(conv.updated_at))}
                </span>
              </Link>
            );
          })}
        </div>
      ))}
    </div>
  );
}
