'use client';

import { useEffect, useState, useMemo, useCallback, memo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useSidebarStore } from '@/lib/store/sidebar-store';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { MessageSquare, Pin } from 'lucide-react';
import { ConversationContextMenu } from './ConversationContextMenu';
import { toast } from 'sonner';
import type { Conversation, Folder } from '@/lib/supabase/types';
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
  folders: Folder[];
}

export function ConversationList({ userId, folders }: ConversationListProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const { searchQuery, activeFolder } = useSidebarStore();
  const pathname = usePathname();
  const router = useRouter();

  const fetchConversations = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from('conversations')
      .select('id, user_id, title, model, summary, system_prompt, topic, message_count, is_pinned, share_token, is_public, folder_id, created_at, updated_at')
      .eq('user_id', userId)
      .order('is_pinned', { ascending: false })
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

  // Filter by search query and active folder
  const filtered = useMemo(() => {
    let result = conversations;

    // Filter by folder
    if (activeFolder) {
      result = result.filter((c) => c.folder_id === activeFolder);
    }

    // Filter by search
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter((c) => c.title.toLowerCase().includes(q));
    }

    return result;
  }, [conversations, searchQuery, activeFolder]);

  // Separate pinned and unpinned, then group unpinned by date
  const pinned = useMemo(() => filtered.filter((c) => c.is_pinned), [filtered]);
  const unpinned = useMemo(() => filtered.filter((c) => !c.is_pinned), [filtered]);
  const grouped = useMemo(() => groupByDate(unpinned, (c) => new Date(c.updated_at)), [unpinned]);

  // CRUD handlers
  const handleRename = useCallback(async (id: string, title: string) => {
    const supabase = createClient();
    const { error } = await supabase
      .from('conversations')
      .update({ title })
      .eq('id', id);

    if (error) {
      toast.error('Failed to rename');
    } else {
      setConversations((prev) =>
        prev.map((c) => (c.id === id ? { ...c, title } : c))
      );
    }
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    const supabase = createClient();
    const { error } = await supabase
      .from('conversations')
      .delete()
      .eq('id', id);

    if (error) {
      toast.error('Failed to delete');
    } else {
      setConversations((prev) => prev.filter((c) => c.id !== id));
      toast.success('Conversation deleted');
      // Navigate away if the deleted conversation was active
      if (pathname === `/chat/${id}`) {
        router.push('/chat');
      }
    }
  }, [pathname, router]);

  const handlePin = useCallback(async (id: string, pinned: boolean) => {
    const supabase = createClient();
    const { error } = await supabase
      .from('conversations')
      .update({ is_pinned: pinned })
      .eq('id', id);

    if (error) {
      toast.error('Failed to update pin');
    } else {
      setConversations((prev) =>
        prev.map((c) => (c.id === id ? { ...c, is_pinned: pinned } : c))
      );
      toast.success(pinned ? 'Pinned' : 'Unpinned');
    }
  }, []);

  const handleMoveToFolder = useCallback(async (id: string, folderId: string | null) => {
    const supabase = createClient();
    const { error } = await supabase
      .from('conversations')
      .update({ folder_id: folderId })
      .eq('id', id);

    if (error) {
      toast.error('Failed to move');
    } else {
      setConversations((prev) =>
        prev.map((c) => (c.id === id ? { ...c, folder_id: folderId } : c))
      );
      toast.success(folderId ? 'Moved to folder' : 'Removed from folder');
    }
  }, []);

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
          {searchQuery ? 'No conversations found' : activeFolder ? 'No conversations in this folder' : 'No conversations yet'}
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-y-auto chat-scroll h-full py-1 px-2">
      {/* Pinned conversations */}
      {pinned.length > 0 && (
        <div className="mb-3">
          <p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] flex items-center gap-1">
            <Pin className="w-2.5 h-2.5" />
            Pinned
          </p>
          {pinned.map((conv) => (
            <ConversationItem
              key={conv.id}
              conversation={conv}
              isActive={pathname === `/chat/${conv.id}`}
              folders={folders}
              onRename={handleRename}
              onDelete={handleDelete}
              onPin={handlePin}
              onMoveToFolder={handleMoveToFolder}
            />
          ))}
        </div>
      )}

      {/* Grouped conversations */}
      {grouped.map(({ label, items }) => (
        <div key={label} className="mb-3">
          <p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
            {label}
          </p>
          {items.map((conv) => (
            <ConversationItem
              key={conv.id}
              conversation={conv}
              isActive={pathname === `/chat/${conv.id}`}
              folders={folders}
              onRename={handleRename}
              onDelete={handleDelete}
              onPin={handlePin}
              onMoveToFolder={handleMoveToFolder}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

const ConversationItem = memo(function ConversationItem({
  conversation,
  isActive,
  folders,
  onRename,
  onDelete,
  onPin,
  onMoveToFolder,
}: {
  conversation: Conversation;
  isActive: boolean;
  folders: Folder[];
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  onMoveToFolder: (id: string, folderId: string | null) => void;
}) {
  const color = MODEL_COLORS[conversation.model] ?? 'var(--muted-foreground)';
  const { setOpen } = useSidebarStore();

  // Close sidebar on mobile when navigating
  const handleClick = () => {
    if (window.innerWidth < 768) {
      setOpen(false);
    }
  };

  return (
    <Link
      href={`/chat/${conversation.id}`}
      onClick={handleClick}
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
      <span className="flex-1 truncate text-xs font-medium">{conversation.title}</span>

      {/* Time on hover (hidden when context menu is visible) */}
      <span className="text-[10px] text-[var(--muted-foreground)] flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-150 hidden group-hover:inline">
        {formatRelativeTime(new Date(conversation.updated_at))}
      </span>

      {/* Context menu */}
      <ConversationContextMenu
        conversation={conversation}
        folders={folders}
        onRename={onRename}
        onDelete={onDelete}
        onPin={onPin}
        onMoveToFolder={onMoveToFolder}
      />
    </Link>
  );
});
