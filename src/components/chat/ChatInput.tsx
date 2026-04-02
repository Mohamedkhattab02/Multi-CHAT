'use client';

import { useCallback, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { Send, Paperclip, X, Image as ImageIcon, FileText } from 'lucide-react';
import { ModelSelector } from './ModelSelector';
import { VoiceInput } from './VoiceInput';
import { MAX_FILE_SIZE, MAX_ATTACHMENTS, type ModelId } from '@/lib/utils/constants';
import { toast } from 'sonner';

interface Attachment {
  file: File;
  preview?: string;
  type: string;
  name: string;
  size: number;
}

interface ChatInputProps {
  selectedModel: ModelId;
  onModelChange: (model: ModelId) => void;
  onSend: (message: string, attachments: Attachment[]) => void;
  isStreaming: boolean;
  disabled?: boolean;
}

export function ChatInput({
  selectedModel,
  onModelChange,
  onSend,
  isStreaming,
  disabled = false,
}: ChatInputProps) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        bulletList: false,
        orderedList: false,
        blockquote: false,
        horizontalRule: false,
      }),
      Placeholder.configure({
        placeholder: 'Message MultiChat AI...',
      }),
    ],
    editorProps: {
      attributes: {
        class:
          'prose prose-sm max-w-none focus:outline-none min-h-[24px] max-h-[200px] overflow-y-auto text-sm text-[var(--foreground)] leading-relaxed',
      },
      handleKeyDown(view, event) {
        // Enter to send, Shift+Enter for newline
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          handleSend();
          return true;
        }
        return false;
      },
    },
    immediatelyRender: false,
  });

  const handleSend = useCallback(() => {
    if (!editor || isStreaming || disabled) return;

    const text = editor.getText().trim();
    if (!text && attachments.length === 0) return;

    onSend(text, attachments);
    editor.commands.clearContent();
    setAttachments([]);
  }, [editor, isStreaming, disabled, attachments, onSend]);

  const handleVoiceTranscript = useCallback(
    (text: string) => {
      if (!editor) return;
      editor.commands.insertContent(text);
    },
    [editor]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);

      for (const file of files) {
        if (attachments.length >= MAX_ATTACHMENTS) {
          toast.error(`Maximum ${MAX_ATTACHMENTS} files allowed`);
          break;
        }

        if (file.size > MAX_FILE_SIZE) {
          toast.error(`${file.name} is too large (max 10MB)`);
          continue;
        }

        const attachment: Attachment = {
          file,
          type: file.type,
          name: file.name,
          size: file.size,
        };

        // Generate preview for images
        if (file.type.startsWith('image/')) {
          attachment.preview = URL.createObjectURL(file);
        }

        setAttachments((prev) => [...prev, attachment]);
      }

      // Reset input
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    [attachments.length]
  );

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => {
      const removed = prev[index];
      if (removed.preview) URL.revokeObjectURL(removed.preview);
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const hasContent = editor?.getText().trim().length || attachments.length > 0;

  return (
    <div className="border-t border-[var(--border)] bg-[var(--card)]">
      <div className="max-w-3xl mx-auto px-4 py-3">
        {/* Attachment previews */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {attachments.map((att, i) => (
              <div
                key={i}
                className="relative group flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--secondary)] text-sm"
              >
                {att.preview ? (
                  <img
                    src={att.preview}
                    alt={att.name}
                    className="w-10 h-10 rounded object-cover"
                  />
                ) : att.type.startsWith('image') ? (
                  <ImageIcon className="w-4 h-4 text-[var(--muted-foreground)]" />
                ) : (
                  <FileText className="w-4 h-4 text-[var(--muted-foreground)]" />
                )}
                <span className="text-xs text-[var(--foreground)] truncate max-w-[120px]">
                  {att.name}
                </span>
                <button
                  onClick={() => removeAttachment(i)}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-[var(--destructive)] text-white flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Main input area */}
        <div className="flex items-end gap-2 p-2 border border-[var(--border)] rounded-xl bg-[var(--background)] transition-all duration-200 focus-within:border-[var(--ring)]/50 focus-within:shadow-sm">
          {/* Left actions */}
          <div className="flex items-center gap-0.5 pb-0.5">
            {/* File attach */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="p-2 rounded-full text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--secondary)] transition-colors cursor-pointer"
              title="Attach file"
              disabled={isStreaming}
            >
              <Paperclip size={18} />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,application/pdf,text/plain,text/markdown"
              onChange={handleFileSelect}
              className="hidden"
            />

            {/* Voice input */}
            <VoiceInput onTranscript={handleVoiceTranscript} />

            {/* Model selector */}
            <ModelSelector
              selectedModel={selectedModel}
              onSelect={onModelChange}
            />
          </div>

          {/* Tiptap editor */}
          <div className="flex-1 min-w-0 py-1">
            <EditorContent editor={editor} />
          </div>

          {/* Send button */}
          <button
            type="button"
            onClick={handleSend}
            disabled={isStreaming || disabled || !hasContent}
            className={`p-2 rounded-full transition-all cursor-pointer mb-0.5 ${
              hasContent && !isStreaming
                ? 'bg-[var(--primary)] text-[var(--primary-foreground)] hover:opacity-90'
                : 'text-[var(--muted-foreground)] bg-[var(--secondary)]'
            }`}
            title="Send message"
          >
            <Send size={18} />
          </button>
        </div>

        <p className="text-center text-[10px] text-[var(--muted-foreground)] mt-2">
          MultiChat AI may produce inaccurate information. Verify important facts.
        </p>
      </div>
    </div>
  );
}
