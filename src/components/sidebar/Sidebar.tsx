'use client';

import { useSidebarStore } from '@/lib/store/sidebar-store';
import { motion, AnimatePresence } from 'framer-motion';
import { PenSquare, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { ConversationList } from './ConversationList';
import { SearchBar } from './SearchBar';
import { UserMenu } from './UserMenu';

interface SidebarProps {
  userId: string;
}

export function Sidebar({ userId }: SidebarProps) {
  const { isOpen, toggle } = useSidebarStore();
  const router = useRouter();

  async function createNewChat() {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('conversations')
      .insert({
        user_id: userId,
        title: 'New conversation',
        model: 'gemini-3.1-pro',
      })
      .select()
      .single();

    if (data && !error) {
      router.push(`/chat/${data.id}`);
    }
  }

  return (
    <>
      {/* Mobile overlay */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 z-20 md:hidden"
            onClick={toggle}
          />
        )}
      </AnimatePresence>

      {/* Sidebar panel */}
      <motion.aside
        initial={false}
        animate={{ width: isOpen ? 'var(--sidebar-width, 260px)' : '0px' }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className="relative flex-shrink-0 overflow-hidden border-r border-[var(--sidebar-border)] bg-[var(--sidebar-bg)] z-30 md:relative fixed inset-y-0 left-0"
      >
        <div className="flex flex-col h-full w-[260px]">
          {/* Top bar */}
          <div className="flex items-center gap-2 p-3">
            <span className="flex-1 font-semibold text-sm text-[var(--foreground)] px-1">
              MultiChat AI
            </span>
            <button
              onClick={createNewChat}
              className="p-1.5 rounded-lg hover:bg-[var(--accent)] transition-colors"
              title="New chat (Ctrl+N)"
            >
              <PenSquare className="w-4 h-4 text-[var(--muted-foreground)]" />
            </button>
            <button
              onClick={toggle}
              className="p-1.5 rounded-lg hover:bg-[var(--accent)] transition-colors md:hidden"
            >
              <X className="w-4 h-4 text-[var(--muted-foreground)]" />
            </button>
          </div>

          {/* Search */}
          <div className="px-2 pb-2">
            <SearchBar />
          </div>

          {/* Conversation list */}
          <div className="flex-1 overflow-hidden">
            <ConversationList userId={userId} />
          </div>

          {/* User menu */}
          <div className="border-t border-[var(--sidebar-border)]">
            <UserMenu />
          </div>
        </div>
      </motion.aside>
    </>
  );
}
