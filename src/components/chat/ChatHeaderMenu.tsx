'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { MoreHorizontal, Download, FileText, FileDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';

interface ChatHeaderMenuProps {
  conversationId: string;
  title: string;
}

export function ChatHeaderMenu({ conversationId, title }: ChatHeaderMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const handleExportMd = useCallback(async () => {
    try {
      const supabase = createClient();
      const { data: messages } = await supabase
        .from('messages')
        .select('role, content, created_at')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });

      if (!messages?.length) {
        toast.error('No messages to export');
        return;
      }

      let md = `# ${title}\n\n---\n\n`;
      for (const msg of messages) {
        const role = msg.role === 'user' ? '**You**' : '**Assistant**';
        md += `${role}:\n\n${msg.content}\n\n---\n\n`;
      }

      const blob = new Blob([md], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${title.replace(/[^a-z0-9]/gi, '_').slice(0, 50)}.md`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Exported as Markdown');
    } catch {
      toast.error('Failed to export');
    }
    setIsOpen(false);
  }, [conversationId, title]);

  const handleExportPdf = useCallback(async () => {
    try {
      toast.loading('Generating PDF...', { id: 'pdf-export' });

      const res = await fetch('/api/export-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId }),
      });

      if (!res.ok) {
        throw new Error('Failed to generate PDF');
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${title.replace(/[^a-z0-9]/gi, '_').slice(0, 50)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Exported as PDF', { id: 'pdf-export' });
    } catch {
      toast.error('Failed to export PDF', { id: 'pdf-export' });
    }
    setIsOpen(false);
  }, [conversationId, title]);

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="p-1.5 rounded-lg hover:bg-[var(--secondary)] transition-colors cursor-pointer"
        title="More options"
      >
        <MoreHorizontal className="w-4 h-4 text-[var(--muted-foreground)]" />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -4 }}
            transition={{ duration: 0.12 }}
            className="absolute right-0 top-9 z-50 w-48 rounded-lg border border-[var(--border)] bg-[var(--popover)] text-[var(--popover-foreground)] shadow-lg overflow-hidden"
          >
            <div className="py-1">
              <button
                onClick={handleExportMd}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-[var(--accent)] transition-colors cursor-pointer"
              >
                <FileText className="w-3.5 h-3.5 text-[var(--muted-foreground)]" />
                Export as Markdown
              </button>
              <button
                onClick={handleExportPdf}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-[var(--accent)] transition-colors cursor-pointer"
              >
                <FileDown className="w-3.5 h-3.5 text-[var(--muted-foreground)]" />
                Export as PDF
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
