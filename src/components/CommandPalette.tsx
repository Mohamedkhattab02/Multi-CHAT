'use client';

import { useEffect, useState, useCallback } from 'react';
import { Command } from 'cmdk';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useUiStore } from '@/lib/store/ui-store';
import { useSidebarStore } from '@/lib/store/sidebar-store';
import { useChatStore } from '@/lib/store/chat-store';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Search,
  Plus,
  MessageSquare,
  Moon,
  Sun,
  Monitor,
  Pin,
  FileText,
  FileDown,
  Keyboard,
  PanelLeftClose,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { toast } from 'sonner';
import type { Conversation } from '@/lib/supabase/types';

export function CommandPalette() {
  const { isCommandPaletteOpen, setCommandPaletteOpen, setShareDialogOpen } = useUiStore();
  const { toggle: toggleSidebar } = useSidebarStore();
  const { activeConversationId } = useChatStore();
  const router = useRouter();
  const { setTheme } = useTheme();
  const [search, setSearch] = useState('');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(false);

  // Global Ctrl+K handler
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setCommandPaletteOpen(!isCommandPaletteOpen);
      }
      if (e.key === 'Escape' && isCommandPaletteOpen) {
        setCommandPaletteOpen(false);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isCommandPaletteOpen, setCommandPaletteOpen]);

  // Search conversations (title + message content via Supabase)
  useEffect(() => {
    if (!isCommandPaletteOpen) return;

    const timeout = setTimeout(async () => {
      setLoading(true);
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }

      let query = supabase
        .from('conversations')
        .select('id, user_id, title, model, summary, system_prompt, topic, message_count, is_pinned, share_token, is_public, folder_id, created_at, updated_at')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false })
        .limit(20);

      if (search.trim()) {
        query = query.ilike('title', `%${search.trim()}%`);
      }

      const { data } = await query;
      setConversations(data ?? []);
      setLoading(false);
    }, 150);

    return () => clearTimeout(timeout);
  }, [isCommandPaletteOpen, search]);

  const createNewChat = useCallback(async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data } = await supabase
      .from('conversations')
      .insert({ user_id: user.id, title: 'New conversation', model: 'gemini-3.1-pro' })
      .select('id')
      .single();

    if (data) {
      router.push(`/chat/${data.id}`);
      setCommandPaletteOpen(false);
    }
  }, [router, setCommandPaletteOpen]);

  const handleExportPdf = useCallback(async () => {
    if (!activeConversationId) {
      toast.error('No active conversation to export');
      return;
    }
    toast.loading('Generating PDF...', { id: 'pdf-export' });
    try {
      const res = await fetch('/api/export-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: activeConversationId }),
      });
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'conversation.pdf';
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Exported as PDF', { id: 'pdf-export' });
    } catch {
      toast.error('Failed to export PDF', { id: 'pdf-export' });
    }
  }, [activeConversationId]);

  const handleExportMd = useCallback(async () => {
    if (!activeConversationId) {
      toast.error('No active conversation to export');
      return;
    }
    const supabase = createClient();
    const [{ data: conv }, { data: messages }] = await Promise.all([
      supabase.from('conversations').select('title, model, created_at').eq('id', activeConversationId).single(),
      supabase.from('messages').select('role, content, created_at').eq('conversation_id', activeConversationId).order('created_at', { ascending: true }),
    ]);
    if (!conv || !messages?.length) { toast.error('No messages to export'); return; }
    let md = `# ${conv.title}\n\n**Model:** ${conv.model}\n**Date:** ${new Date(conv.created_at).toLocaleDateString()}\n\n---\n\n`;
    for (const msg of messages) {
      md += `${msg.role === 'user' ? '**You**' : '**Assistant**'}:\n\n${msg.content}\n\n---\n\n`;
    }
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${conv.title.replace(/[^a-z0-9]/gi, '_').slice(0, 50)}.md`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Exported as Markdown');
  }, [activeConversationId]);

  const runAction = useCallback((action: () => void) => {
    action();
    setCommandPaletteOpen(false);
    setSearch('');
  }, [setCommandPaletteOpen]);

  return (
    <AnimatePresence>
      {isCommandPaletteOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50"
            onClick={() => setCommandPaletteOpen(false)}
          />

          {/* Command dialog */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -20 }}
            transition={{ duration: 0.15 }}
            className="fixed top-[15%] left-1/2 -translate-x-1/2 w-full max-w-lg z-50 px-4 sm:px-0"
          >
            <Command
              className="rounded-xl border border-[var(--border)] bg-[var(--popover)] shadow-2xl overflow-hidden"
              label="Command palette"
            >
              {/* Search input */}
              <div className="flex items-center gap-3 px-4 border-b border-[var(--border)]">
                <Search className="w-4 h-4 text-[var(--muted-foreground)] flex-shrink-0" />
                <Command.Input
                  value={search}
                  onValueChange={setSearch}
                  placeholder="Search conversations, commands..."
                  className="flex-1 py-3.5 text-sm bg-transparent outline-none text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]"
                />
                <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-mono text-[var(--muted-foreground)] bg-[var(--secondary)] rounded border border-[var(--border)]">
                  ESC
                </kbd>
              </div>

              <Command.List className="max-h-80 overflow-y-auto p-2 chat-scroll">
                <Command.Empty className="py-8 text-center text-sm text-[var(--muted-foreground)]">
                  {loading ? 'Searching...' : 'No results found'}
                </Command.Empty>

                {/* Quick actions */}
                <Command.Group heading="Actions" className="mb-2">
                  <CommandItem
                    icon={Plus}
                    label="New conversation"
                    shortcut="Ctrl+N"
                    onSelect={() => runAction(createNewChat)}
                  />
                  <CommandItem
                    icon={PanelLeftClose}
                    label="Toggle sidebar"
                    shortcut="Ctrl+B"
                    onSelect={() => runAction(toggleSidebar)}
                  />
                </Command.Group>

                {/* Export (only when in a conversation) */}
                {activeConversationId && (
                  <Command.Group heading="Export" className="mb-2">
                    <CommandItem
                      icon={FileText}
                      label="Export as Markdown"
                      shortcut="Ctrl+Shift+E"
                      onSelect={() => runAction(handleExportMd)}
                    />
                    <CommandItem
                      icon={FileDown}
                      label="Export as PDF"
                      onSelect={() => runAction(handleExportPdf)}
                    />
                  </Command.Group>
                )}

                {/* Theme */}
                <Command.Group heading="Theme" className="mb-2">
                  <CommandItem
                    icon={Sun}
                    label="Light mode"
                    onSelect={() => runAction(() => setTheme('light'))}
                  />
                  <CommandItem
                    icon={Moon}
                    label="Dark mode"
                    onSelect={() => runAction(() => setTheme('dark'))}
                  />
                  <CommandItem
                    icon={Monitor}
                    label="System theme"
                    onSelect={() => runAction(() => setTheme('system'))}
                  />
                </Command.Group>

                {/* Conversations */}
                {conversations.length > 0 && (
                  <Command.Group heading="Conversations" className="mb-2">
                    {conversations.map((conv) => (
                      <CommandItem
                        key={conv.id}
                        icon={conv.is_pinned ? Pin : MessageSquare}
                        label={conv.title}
                        subtitle={conv.model}
                        onSelect={() =>
                          runAction(() => router.push(`/chat/${conv.id}`))
                        }
                      />
                    ))}
                  </Command.Group>
                )}
              </Command.List>

              {/* Footer */}
              <div className="flex items-center justify-between px-4 py-2 border-t border-[var(--border)] text-[10px] text-[var(--muted-foreground)]">
                <span>↑↓ Navigate</span>
                <span>↵ Select</span>
                <span>ESC Close</span>
              </div>
            </Command>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function CommandItem({
  icon: Icon,
  label,
  subtitle,
  shortcut,
  onSelect,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  subtitle?: string;
  shortcut?: string;
  onSelect: () => void;
}) {
  return (
    <Command.Item
      onSelect={onSelect}
      className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm cursor-pointer data-[selected=true]:bg-[var(--accent)] transition-colors"
    >
      <Icon className="w-4 h-4 text-[var(--muted-foreground)] flex-shrink-0" />
      <span className="flex-1 truncate text-[var(--foreground)]">{label}</span>
      {subtitle && (
        <span className="text-[10px] text-[var(--muted-foreground)]">{subtitle}</span>
      )}
      {shortcut && (
        <kbd className="text-[10px] font-mono text-[var(--muted-foreground)] bg-[var(--secondary)] px-1.5 py-0.5 rounded border border-[var(--border)]">
          {shortcut}
        </kbd>
      )}
    </Command.Item>
  );
}
