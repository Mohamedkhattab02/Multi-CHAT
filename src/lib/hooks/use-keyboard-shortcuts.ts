'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useUiStore } from '@/lib/store/ui-store';
import { useSidebarStore } from '@/lib/store/sidebar-store';

export function useKeyboardShortcuts() {
  const router = useRouter();
  const { setCommandPaletteOpen } = useUiStore();
  const { toggle: toggleSidebar } = useSidebarStore();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const ctrl = e.ctrlKey || e.metaKey;

      // Don't trigger in input/textarea (except for global shortcuts)
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' ||
        target.isContentEditable;

      // Ctrl+K — Command palette (always active)
      if (ctrl && e.key === 'k') {
        e.preventDefault();
        setCommandPaletteOpen(true);
        return;
      }

      // Ctrl+B — Toggle sidebar (always active)
      if (ctrl && e.key === 'b') {
        e.preventDefault();
        toggleSidebar();
        return;
      }

      // Below shortcuts only work outside inputs
      if (isInput) return;

      // Ctrl+Shift+O — New chat
      if (ctrl && e.shiftKey && (e.key === 'o' || e.key === 'O')) {
        e.preventDefault();
        createNewChat();
        return;
      }

      // Ctrl+Shift+E — Export current chat as markdown
      if (ctrl && e.shiftKey && e.key === 'E') {
        e.preventDefault();
        exportCurrentChat();
        return;
      }
    }

    async function createNewChat() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from('conversations')
        .insert({ user_id: user.id, title: 'New conversation', model: 'gemini-3.1-pro' })
        .select('id')
        .single();

      if (data) router.push(`/chat/${data.id}`);
    }

    async function exportCurrentChat() {
      // Get current conversation ID from URL
      const match = window.location.pathname.match(/\/chat\/(.+)/);
      if (!match) return;

      const conversationId = match[1];
      const supabase = createClient();

      const [{ data: conv }, { data: messages }] = await Promise.all([
        supabase.from('conversations')
          .select('title, model, created_at')
          .eq('id', conversationId)
          .single(),
        supabase.from('messages')
          .select('role, content, created_at')
          .eq('conversation_id', conversationId)
          .order('created_at', { ascending: true }),
      ]);

      if (!conv || !messages?.length) return;

      let md = `# ${conv.title}\n\n**Model:** ${conv.model}\n**Date:** ${new Date(conv.created_at).toLocaleDateString()}\n\n---\n\n`;
      for (const msg of messages) {
        const role = msg.role === 'user' ? '**You**' : '**Assistant**';
        md += `${role}:\n\n${msg.content}\n\n---\n\n`;
      }

      const blob = new Blob([md], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${conv.title.replace(/[^a-z0-9]/gi, '_').slice(0, 50)}.md`;
      a.click();
      URL.revokeObjectURL(url);
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [router, setCommandPaletteOpen, toggleSidebar]);
}
