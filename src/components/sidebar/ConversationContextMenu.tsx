'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Pencil,
  Trash2,
  Pin,
  PinOff,
  Share2,
  FolderInput,
  Download,
  FileText,
  FileDown,
  MoreHorizontal,
} from 'lucide-react';
import { toast } from 'sonner';
import { useUiStore } from '@/lib/store/ui-store';
import type { Conversation, Folder } from '@/lib/supabase/types';

interface ConversationContextMenuProps {
  conversation: Conversation;
  folders: Folder[];
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  onMoveToFolder: (id: string, folderId: string | null) => void;
}

export function ConversationContextMenu({
  conversation,
  folders,
  onRename,
  onDelete,
  onPin,
  onMoveToFolder,
}: ConversationContextMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [showFolderMenu, setShowFolderMenu] = useState(false);
  const [renameValue, setRenameValue] = useState(conversation.title);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { setShareDialogOpen } = useUiStore();

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setShowFolderMenu(false);
      }
    }
    if (isOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  useEffect(() => {
    if (isRenaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isRenaming]);

  const handleRename = useCallback(() => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== conversation.title) {
      onRename(conversation.id, trimmed);
    }
    setIsRenaming(false);
    setIsOpen(false);
  }, [renameValue, conversation.id, conversation.title, onRename]);

  const handleDelete = useCallback(() => {
    if (confirm('Delete this conversation? This cannot be undone.')) {
      onDelete(conversation.id);
    }
    setIsOpen(false);
  }, [conversation.id, onDelete]);

  const handleExportMd = useCallback(async () => {
    try {
      const supabase = createClient();
      const { data: messages } = await supabase
        .from('messages')
        .select('role, content, created_at')
        .eq('conversation_id', conversation.id)
        .order('created_at', { ascending: true });

      if (!messages?.length) {
        toast.error('No messages to export');
        return;
      }

      let md = `# ${conversation.title}\n\n`;
      md += `**Model:** ${conversation.model}\n`;
      md += `**Date:** ${new Date(conversation.created_at).toLocaleDateString()}\n\n---\n\n`;

      for (const msg of messages) {
        const role = msg.role === 'user' ? '**You**' : '**Assistant**';
        md += `${role}:\n\n${msg.content}\n\n---\n\n`;
      }

      const blob = new Blob([md], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${conversation.title.replace(/[^a-z0-9]/gi, '_').slice(0, 50)}.md`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Exported as Markdown');
    } catch {
      toast.error('Failed to export');
    }
    setIsOpen(false);
  }, [conversation]);

  const handleExportPdf = useCallback(async () => {
    try {
      toast.loading('Generating PDF...', { id: 'pdf-export' });
      const res = await fetch('/api/export-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: conversation.id }),
      });
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${conversation.title.replace(/[^a-z0-9]/gi, '_').slice(0, 50)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Exported as PDF', { id: 'pdf-export' });
    } catch {
      toast.error('Failed to export PDF', { id: 'pdf-export' });
    }
    setIsOpen(false);
  }, [conversation]);

  if (isRenaming) {
    return (
      <input
        ref={inputRef}
        value={renameValue}
        onChange={(e) => setRenameValue(e.target.value)}
        onBlur={handleRename}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleRename();
          if (e.key === 'Escape') {
            setRenameValue(conversation.title);
            setIsRenaming(false);
          }
        }}
        className="flex-1 text-xs font-medium bg-transparent border border-[var(--ring)] rounded px-1.5 py-0.5 outline-none text-[var(--foreground)]"
        onClick={(e) => e.preventDefault()}
      />
    );
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        className="p-1 rounded hover:bg-[var(--sidebar-hover)] transition-colors opacity-0 group-hover:opacity-100 cursor-pointer"
      >
        <MoreHorizontal className="w-3.5 h-3.5 text-[var(--muted-foreground)]" />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -4 }}
            transition={{ duration: 0.12 }}
            className="absolute right-0 top-7 z-50 w-48 rounded-lg border border-[var(--border)] bg-[var(--popover)] text-[var(--popover-foreground)] shadow-lg overflow-hidden"
          >
            <div className="py-1">
              <MenuItem
                icon={Pencil}
                label="Rename"
                onClick={() => {
                  setRenameValue(conversation.title);
                  setIsRenaming(true);
                  setIsOpen(false);
                }}
              />
              <MenuItem
                icon={conversation.is_pinned ? PinOff : Pin}
                label={conversation.is_pinned ? 'Unpin' : 'Pin to top'}
                onClick={() => {
                  onPin(conversation.id, !conversation.is_pinned);
                  setIsOpen(false);
                }}
              />
              <MenuItem
                icon={Share2}
                label="Share"
                onClick={() => {
                  setShareDialogOpen(true, conversation.id);
                  setIsOpen(false);
                }}
              />

              {/* Folder submenu */}
              <div className="relative">
                <MenuItem
                  icon={FolderInput}
                  label="Move to folder"
                  onClick={() => setShowFolderMenu(!showFolderMenu)}
                  hasSubmenu
                />
                <AnimatePresence>
                  {showFolderMenu && (
                    <motion.div
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      className="absolute right-0 top-full mt-1 w-40 rounded-lg border border-[var(--border)] bg-[var(--popover)] shadow-lg py-1 z-50 max-h-48 overflow-y-auto"
                    >
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          onMoveToFolder(conversation.id, null);
                          setIsOpen(false);
                          setShowFolderMenu(false);
                        }}
                        className="w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--accent)] transition-colors cursor-pointer text-[var(--muted-foreground)]"
                      >
                        No folder
                      </button>
                      {folders.map((f) => (
                        <button
                          key={f.id}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onMoveToFolder(conversation.id, f.id);
                            setIsOpen(false);
                            setShowFolderMenu(false);
                          }}
                          className={`w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--accent)] transition-colors cursor-pointer ${
                            conversation.folder_id === f.id ? 'text-[var(--primary)] font-medium' : ''
                          }`}
                        >
                          {f.icon} {f.name}
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <div className="h-px bg-[var(--border)] my-1" />

              <MenuItem icon={Download} label="Export (.md)" onClick={handleExportMd} />
              <MenuItem icon={FileDown} label="Export (.pdf)" onClick={handleExportPdf} />

              <div className="h-px bg-[var(--border)] my-1" />

              <MenuItem
                icon={Trash2}
                label="Delete"
                onClick={handleDelete}
                destructive
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  destructive = false,
  hasSubmenu = false,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  destructive?: boolean;
  hasSubmenu?: boolean;
}) {
  return (
    <button
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-xs transition-colors cursor-pointer ${
        destructive
          ? 'text-[var(--destructive)] hover:bg-[var(--destructive)]/10'
          : 'hover:bg-[var(--accent)]'
      }`}
    >
      <Icon className="w-3.5 h-3.5" />
      <span className="flex-1 text-left">{label}</span>
      {hasSubmenu && <span className="text-[var(--muted-foreground)]">›</span>}
    </button>
  );
}
