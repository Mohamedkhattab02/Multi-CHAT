'use client';

import { useCallback, useRef, useState, KeyboardEvent } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { Paperclip, Send, Square } from 'lucide-react';
import { ModelSelector } from './ModelSelector';
import { VoiceInput } from './VoiceInput';
import { FilePreview, type PendingAttachment } from './FilePreview';
import { MAX_FILE_SIZE, MAX_ATTACHMENTS } from '@/lib/utils/constants';
import type { ModelId } from '@/lib/utils/constants';
import { cn } from '@/lib/utils/cn';
import { toast } from 'sonner';

// ============================================================
// ChatInput — Tiptap rich text editor + file attach + voice + model selector
// Enter to send, Shift+Enter for newline
// ============================================================

interface ChatInputProps {
  onSend: (message: string, attachments: PendingAttachment[]) => void;
  onStop: () => void;
  isStreaming: boolean;
  selectedModel: ModelId;
  onModelChange: (model: ModelId) => void;
  overrideBadge?: string | null;
  disabled?: boolean;
  userLanguage?: string;
}

function getAttachmentType(file: File): 'image' | 'pdf' | 'document' {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type === 'application/pdf') return 'pdf';
  return 'document';
}

export function ChatInput({
  onSend,
  onStop,
  isStreaming,
  selectedModel,
  onModelChange,
  overrideBadge,
  disabled,
  userLanguage = 'auto',
}: ChatInputProps) {
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        // Disable block-level nodes we don't need in chat input
        heading: false,
        codeBlock: false,
        horizontalRule: false,
        blockquote: false,
      }),
      Placeholder.configure({
        placeholder: 'Message MultiChat AI...',
        emptyEditorClass: 'is-editor-empty',
      }),
    ],
    editorProps: {
      attributes: {
        class: 'outline-none min-h-[24px] max-h-[200px] overflow-y-auto text-sm leading-relaxed text-[var(--foreground)]',
      },
    },
  });

  const getTextContent = useCallback((): string => {
    if (!editor) return '';
    return editor.getText({ blockSeparator: '\n' }).trim();
  }, [editor]);

  const handleSend = useCallback(() => {
    if (!editor || isStreaming || disabled) return;
    const text = getTextContent();
    if (!text && attachments.length === 0) return;

    onSend(text, attachments);
    editor.commands.clearContent();
    setAttachments([]);
  }, [editor, isStreaming, disabled, getTextContent, attachments, onSend]);

  // Enter to send, Shift+Enter for newline
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  // Voice transcript — append to editor
  const handleVoiceTranscript = useCallback(
    (text: string) => {
      if (!editor) return;
      const current = getTextContent();
      editor.commands.setContent(current ? `${current} ${text}` : text);
      editor.commands.focus('end');
    },
    [editor, getTextContent]
  );

  // File attachment
  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      e.target.value = '';

      const remaining = MAX_ATTACHMENTS - attachments.length;
      if (remaining <= 0) {
        toast.error(`Maximum ${MAX_ATTACHMENTS} attachments allowed`);
        return;
      }

      const toAdd: PendingAttachment[] = [];
      for (const file of files.slice(0, remaining)) {
        if (file.size > MAX_FILE_SIZE) {
          toast.error(`${file.name} is too large (max 10MB)`);
          continue;
        }

        const type = getAttachmentType(file);
        const att: PendingAttachment = { file, type };

        if (type === 'image') {
          att.previewUrl = URL.createObjectURL(file);
        }

        toAdd.push(att);
      }

      setAttachments((prev) => [...prev, ...toAdd]);
    },
    [attachments.length]
  );

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => {
      const next = [...prev];
      if (next[index]?.previewUrl) {
        URL.revokeObjectURL(next[index].previewUrl!);
      }
      next.splice(index, 1);
      return next;
    });
  }, []);

  const isEmpty = !getTextContent() && attachments.length === 0;
  const canSend = !isStreaming && !disabled && !isEmpty;

  return (
    <div className="border-t border-[var(--border)] bg-[var(--card)]">
      <div className="max-w-3xl mx-auto px-4 py-3">
        {/* File previews */}
        <FilePreview attachments={attachments} onRemove={removeAttachment} />

        {/* Input container */}
        <div
          className={cn(
            'flex flex-col gap-2 p-3.5 rounded-xl border border-[var(--border)] bg-[var(--background)] transition-all duration-200',
            'hover:border-[var(--ring)]/30',
            'focus-within:border-[var(--ring)]/50 focus-within:ring-2 focus-within:ring-[var(--ring)]/10'
          )}
        >
          {/* Tiptap editor */}
          <EditorContent
            editor={editor}
            onKeyDown={handleKeyDown}
            className="flex-1"
          />

          {/* Toolbar row */}
          <div className="flex items-center gap-1.5">
            {/* File attach */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled || isStreaming || attachments.length >= MAX_ATTACHMENTS}
              title="Attach file"
              className="p-2 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--secondary)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Paperclip size={18} />
            </button>

            {/* Voice input */}
            <VoiceInput
              onTranscript={handleVoiceTranscript}
              language={userLanguage}
              disabled={disabled || isStreaming}
            />

            {/* Spacer */}
            <div className="flex-1" />

            {/* Model selector */}
            <ModelSelector
              value={selectedModel}
              onChange={onModelChange}
              disabled={isStreaming}
              overrideBadge={overrideBadge}
            />

            {/* Send / Stop button */}
            {isStreaming ? (
              <button
                type="button"
                onClick={onStop}
                title="Stop generating"
                className="p-2 rounded-lg bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors"
              >
                <Square size={18} fill="currentColor" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSend}
                disabled={!canSend}
                title="Send message (Enter)"
                className={cn(
                  'p-2 rounded-lg transition-all',
                  canSend
                    ? 'bg-[var(--primary)] text-[var(--primary-foreground)] hover:opacity-90'
                    : 'bg-[var(--secondary)] text-[var(--muted-foreground)] cursor-not-allowed'
                )}
              >
                <Send size={18} />
              </button>
            )}
          </div>
        </div>

        <p className="text-center text-[10px] text-[var(--muted-foreground)] mt-2">
          Enter to send · Shift+Enter for newline · Ctrl+K for commands
        </p>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,application/pdf,text/plain,text/markdown"
        multiple
        className="hidden"
        onChange={handleFileSelect}
      />
    </div>
  );
}
