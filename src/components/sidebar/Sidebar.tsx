'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSidebarStore } from '@/lib/store/sidebar-store';
import { motion, AnimatePresence } from 'framer-motion';
import { PenSquare, X, PanelLeftClose, PanelLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { ConversationList } from './ConversationList';
import { FolderList } from './FolderList';
import { SearchBar } from './SearchBar';
import { UserMenu } from './UserMenu';
import type { Folder } from '@/lib/supabase/types';

interface SidebarProps {
  userId: string;
}

export function Sidebar({ userId }: SidebarProps) {
  const { isOpen, toggle } = useSidebarStore();
  const router = useRouter();
  const [folders, setFolders] = useState<Folder[]>([]);

  const fetchFolders = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from('folders')
      .select('*')
      .eq('user_id', userId)
      .order('sort_order', { ascending: true });

    if (data) setFolders(data);
  }, [userId]);

  useEffect(() => {
    fetchFolders();
  }, [fetchFolders]);

  async function createNewChat() {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('conversations')
      .insert({
        user_id: userId,
        title: 'New conversation',
        model: 'gemini-3.1-pro',
      })
      .select('id')
      .single();

    if (data && !error) {
      router.push(`/chat/${data.id}`);
      // Close sidebar on mobile after creating a chat
      if (window.innerWidth < 768) {
        toggle();
      }
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
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-20 md:hidden"
            onClick={toggle}
          />
        )}
      </AnimatePresence>

      {/* Toggle button when sidebar is closed (desktop) */}
      {!isOpen && (
        <button
          onClick={toggle}
          className="hidden md:flex fixed left-3 top-3 z-10 p-2 rounded-lg hover:bg-[var(--secondary)] transition-colors cursor-pointer"
          title="Open sidebar"
        >
          <PanelLeft className="w-5 h-5 text-[var(--muted-foreground)]" />
        </button>
      )}

      {/* Sidebar panel */}
      <motion.aside
        initial={false}
        animate={{ width: isOpen ? 'var(--sidebar-width, 280px)' : '0px' }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className="relative flex-shrink-0 overflow-hidden border-r border-[var(--sidebar-border)] bg-[var(--sidebar-bg)] z-30 md:relative fixed inset-y-0 left-0"
      >
        <div className="flex flex-col h-full w-[280px]">
          {/* Top bar */}
          <div className="flex items-center gap-2 px-3 py-3">
            <button
              onClick={toggle}
              className="p-1.5 rounded-lg hover:bg-[var(--sidebar-hover)] transition-colors cursor-pointer hidden md:flex"
              title="Close sidebar"
            >
              <PanelLeftClose className="w-4.5 h-4.5 text-[var(--muted-foreground)]" />
            </button>
            <span className="flex-1 font-semibold text-sm text-[var(--foreground)] px-0.5 md:px-0">
              MultiChat AI
            </span>
            <button
              onClick={createNewChat}
              className="p-1.5 rounded-lg hover:bg-[var(--sidebar-hover)] transition-colors cursor-pointer"
              title="New chat (Ctrl+Shift+O)"
            >
              <PenSquare className="w-4 h-4 text-[var(--muted-foreground)]" />
            </button>
            <button
              onClick={toggle}
              className="p-1.5 rounded-lg hover:bg-[var(--sidebar-hover)] transition-colors md:hidden cursor-pointer"
            >
              <X className="w-4 h-4 text-[var(--muted-foreground)]" />
            </button>
          </div>

          {/* Search */}
          <div className="px-3 pb-2">
            <SearchBar />
          </div>

          {/* New chat button (mobile prominent) */}
          <div className="px-3 pb-2 md:hidden">
            <button
              onClick={createNewChat}
              className="w-full flex items-center justify-center gap-2 py-2 text-xs font-medium rounded-lg bg-[var(--primary)] text-[var(--primary-foreground)] hover:brightness-110 transition-all cursor-pointer"
            >
              <PenSquare className="w-3.5 h-3.5" />
              New chat
            </button>
          </div>

          {/* Folders */}
          <FolderList
            userId={userId}
            folders={folders}
            onFoldersChange={fetchFolders}
          />

          {/* Conversation list */}
          <div className="flex-1 overflow-hidden">
            <ConversationList userId={userId} folders={folders} />
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
