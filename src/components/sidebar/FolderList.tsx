'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useSidebarStore } from '@/lib/store/sidebar-store';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FolderPlus,
  Folder as FolderIcon,
  FolderOpen,
  ChevronRight,
  Pencil,
  Trash2,
  MoreHorizontal,
} from 'lucide-react';
import { toast } from 'sonner';
import type { Folder } from '@/lib/supabase/types';

const FOLDER_ICONS = ['📁', '💼', '🔬', '📚', '🎯', '💡', '🏠', '🎨', '📝', '⚡'];

interface FolderListProps {
  userId: string;
  folders: Folder[];
  onFoldersChange: () => void;
}

export function FolderList({ userId, folders, onFoldersChange }: FolderListProps) {
  const { activeFolder, setActiveFolder } = useSidebarStore();
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [menuId, setMenuId] = useState<string | null>(null);
  const createInputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isCreating && createInputRef.current) createInputRef.current.focus();
  }, [isCreating]);

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuId(null);
      }
    }
    if (menuId) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuId]);

  const handleCreate = useCallback(async () => {
    const trimmed = newName.trim();
    if (!trimmed) {
      setIsCreating(false);
      return;
    }

    const supabase = createClient();
    const { error } = await supabase.from('folders').insert({
      user_id: userId,
      name: trimmed,
      icon: FOLDER_ICONS[Math.floor(Math.random() * FOLDER_ICONS.length)],
      sort_order: folders.length,
    });

    if (error) {
      toast.error('Failed to create folder');
    } else {
      toast.success('Folder created');
      onFoldersChange();
    }
    setNewName('');
    setIsCreating(false);
  }, [newName, userId, folders.length, onFoldersChange]);

  const handleRename = useCallback(async (folderId: string) => {
    const trimmed = editName.trim();
    if (!trimmed) {
      setEditingId(null);
      return;
    }

    const supabase = createClient();
    const { error } = await supabase
      .from('folders')
      .update({ name: trimmed })
      .eq('id', folderId);

    if (error) {
      toast.error('Failed to rename folder');
    } else {
      onFoldersChange();
    }
    setEditingId(null);
  }, [editName, onFoldersChange]);

  const handleDelete = useCallback(async (folderId: string) => {
    if (!confirm('Delete this folder? Conversations will be moved out.')) return;

    const supabase = createClient();

    // Unassign conversations first
    await supabase
      .from('conversations')
      .update({ folder_id: null })
      .eq('folder_id', folderId);

    const { error } = await supabase.from('folders').delete().eq('id', folderId);

    if (error) {
      toast.error('Failed to delete folder');
    } else {
      if (activeFolder === folderId) setActiveFolder(null);
      toast.success('Folder deleted');
      onFoldersChange();
    }
    setMenuId(null);
  }, [activeFolder, setActiveFolder, onFoldersChange]);

  return (
    <div className="px-2 pb-1">
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
          Folders
        </p>
        <button
          onClick={() => setIsCreating(true)}
          className="p-0.5 rounded hover:bg-[var(--sidebar-hover)] transition-colors cursor-pointer"
          title="New folder"
        >
          <FolderPlus className="w-3.5 h-3.5 text-[var(--muted-foreground)]" />
        </button>
      </div>

      {/* "All" filter */}
      <button
        onClick={() => setActiveFolder(null)}
        className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-all cursor-pointer ${
          activeFolder === null
            ? 'bg-[var(--sidebar-active)] text-[var(--foreground)] font-medium'
            : 'text-[var(--muted-foreground)] hover:bg-[var(--sidebar-hover)]'
        }`}
      >
        <FolderIcon className="w-3.5 h-3.5" />
        All conversations
      </button>

      {/* Folder list */}
      <AnimatePresence>
        {folders.map((folder) => (
          <motion.div
            key={folder.id}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="group relative"
          >
            {editingId === folder.id ? (
              <div className="flex items-center gap-1.5 px-2.5 py-1.5">
                <span className="text-xs">{folder.icon}</span>
                <input
                  ref={editInputRef}
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onBlur={() => handleRename(folder.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRename(folder.id);
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                  className="flex-1 text-xs bg-transparent border border-[var(--ring)] rounded px-1.5 py-0.5 outline-none text-[var(--foreground)]"
                />
              </div>
            ) : (
              <button
                onClick={() => setActiveFolder(activeFolder === folder.id ? null : folder.id)}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-all cursor-pointer ${
                  activeFolder === folder.id
                    ? 'bg-[var(--sidebar-active)] text-[var(--foreground)] font-medium'
                    : 'text-[var(--foreground)] hover:bg-[var(--sidebar-hover)]'
                }`}
              >
                {activeFolder === folder.id ? (
                  <FolderOpen className="w-3.5 h-3.5 text-[var(--primary)]" />
                ) : (
                  <span className="text-xs w-3.5 text-center">{folder.icon}</span>
                )}
                <span className="flex-1 text-left truncate">{folder.name}</span>

                {/* Context menu trigger */}
                <div
                  ref={menuId === folder.id ? menuRef : null}
                  className="relative"
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuId(menuId === folder.id ? null : folder.id);
                    }}
                    className="p-0.5 rounded hover:bg-[var(--accent)] opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                  >
                    <MoreHorizontal className="w-3 h-3 text-[var(--muted-foreground)]" />
                  </button>

                  <AnimatePresence>
                    {menuId === folder.id && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className="absolute right-0 top-6 z-50 w-32 rounded-lg border border-[var(--border)] bg-[var(--popover)] shadow-lg py-1"
                      >
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditName(folder.name);
                            setEditingId(folder.id);
                            setMenuId(null);
                          }}
                          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-[var(--accent)] cursor-pointer"
                        >
                          <Pencil className="w-3 h-3" /> Rename
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(folder.id);
                          }}
                          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--destructive)] hover:bg-[var(--destructive)]/10 cursor-pointer"
                        >
                          <Trash2 className="w-3 h-3" /> Delete
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </button>
            )}
          </motion.div>
        ))}
      </AnimatePresence>

      {/* Create new folder input */}
      <AnimatePresence>
        {isCreating && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="flex items-center gap-1.5 px-2.5 py-1.5"
          >
            <FolderPlus className="w-3.5 h-3.5 text-[var(--muted-foreground)]" />
            <input
              ref={createInputRef}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onBlur={handleCreate}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate();
                if (e.key === 'Escape') setIsCreating(false);
              }}
              placeholder="Folder name..."
              className="flex-1 text-xs bg-transparent border border-[var(--ring)] rounded px-1.5 py-0.5 outline-none text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]"
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
