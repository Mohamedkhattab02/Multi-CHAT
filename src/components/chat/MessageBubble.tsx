'use client';

import { memo, useState, useCallback } from 'react';
import { Copy, Check, RefreshCw, Trash2, FileText, FileSpreadsheet, FileImage, File, Download, ExternalLink } from 'lucide-react';
import { MODELS, type ModelId } from '@/lib/utils/constants';
import { MarkdownRenderer } from './MarkdownRenderer';
import type { Message } from '@/lib/supabase/types';

interface AttachmentData {
  type?: string;
  data?: string;
  name?: string;
  url?: string;
  size?: number;
}

function getFileIcon(type: string) {
  if (type.startsWith('image/')) return FileImage;
  if (type.includes('spreadsheet') || type.includes('excel') || type === 'text/csv') return FileSpreadsheet;
  if (type.includes('word') || type === 'application/pdf' || type.includes('text/')) return FileText;
  return File;
}

function getFileColor(type: string): string {
  if (type === 'application/pdf') return '#EF4444';
  if (type.includes('word') || type === 'application/msword') return '#3B82F6';
  if (type.includes('spreadsheet') || type.includes('excel') || type === 'text/csv') return '#22C55E';
  if (type.includes('presentation') || type.includes('powerpoint')) return '#F97316';
  if (type.startsWith('image/')) return '#8B5CF6';
  if (type === 'application/json') return '#EAB308';
  return '#6B7280';
}

function getFileExtension(name: string): string {
  const ext = name.split('.').pop()?.toUpperCase();
  return ext || 'FILE';
}

function formatFileSize(bytes?: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function AttachmentPreview({ attachment }: { attachment: AttachmentData }) {
  const [expanded, setExpanded] = useState(false);
  const isImage = attachment.type?.startsWith('image/');
  const Icon = getFileIcon(attachment.type || '');
  const imageUrl = attachment.url || (attachment.data ? `data:${attachment.type};base64,${attachment.data}` : null);

  if (isImage && imageUrl) {
    return (
      <div className="mt-2">
        <img
          src={imageUrl}
          alt={attachment.name || 'attachment'}
          className="max-w-[300px] max-h-[300px] rounded-lg cursor-pointer hover:opacity-90 transition-opacity border border-[var(--border)]"
          loading="lazy"
          onClick={() => setExpanded(true)}
        />
        {expanded && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm cursor-pointer"
            onClick={() => setExpanded(false)}
          >
            <img
              src={imageUrl}
              alt={attachment.name || 'attachment'}
              className="max-w-[90vw] max-h-[90vh] rounded-lg shadow-2xl"
            />
            {attachment.url && (
              <a
                href={attachment.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="absolute top-4 right-4 p-2 rounded-full bg-white/20 hover:bg-white/30 transition-colors"
                title="Open in new tab"
              >
                <ExternalLink className="w-5 h-5 text-white" />
              </a>
            )}
          </div>
        )}
      </div>
    );
  }

  // Non-image file attachment
  const fileColor = getFileColor(attachment.type || '');
  const fileExt = getFileExtension(attachment.name || 'file');

  return (
    <div className="mt-2">
      {attachment.url ? (
        <a
          href={attachment.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-3 px-4 py-3 rounded-xl border border-[var(--border)] bg-[var(--secondary)]/30 hover:bg-[var(--secondary)]/60 transition-colors max-w-[320px] group/file"
        >
          {/* File type badge */}
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 text-white text-[10px] font-bold"
            style={{ backgroundColor: fileColor }}
          >
            {fileExt}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-[var(--foreground)] truncate">
              {attachment.name || 'File'}
            </p>
            <p className="text-[10px] text-[var(--muted-foreground)]">
              {formatFileSize(attachment.size)} &middot; Click to open
            </p>
          </div>
          <ExternalLink className="w-3.5 h-3.5 text-[var(--muted-foreground)] opacity-0 group-hover/file:opacity-100 transition-opacity flex-shrink-0" />
        </a>
      ) : (
        <div className="inline-flex items-center gap-3 px-4 py-3 rounded-xl border border-[var(--border)] bg-[var(--secondary)]/30 max-w-[320px]">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 text-white text-[10px] font-bold"
            style={{ backgroundColor: fileColor }}
          >
            {fileExt}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-[var(--foreground)] truncate">
              {attachment.name || 'File'}
            </p>
            <p className="text-[10px] text-[var(--muted-foreground)]">
              {formatFileSize(attachment.size)}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

interface MessageBubbleProps {
  message: Message;
  onRegenerate?: (messageId: string) => void;
  onDelete?: (messageId: string) => void;
}

export const MessageBubble = memo(function MessageBubble({
  message,
  onRegenerate,
  onDelete,
}: MessageBubbleProps) {
  const [copied, setCopied] = useState(false);
  const [showActions, setShowActions] = useState(false);

  const model = MODELS[message.model as ModelId];
  const modelColor = model?.color ?? '#737373';

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [message.content]);

  const relativeTime = useRelativeTime(message.created_at);

  // Parse attachments
  const attachments = (message.attachments || []) as AttachmentData[];
  const generatedImage = attachments.find(
    (a) => a.type?.startsWith('image') && a.data
  );

  if (message.role === 'user') {
    return (
      <div
        className="flex justify-end group"
        onMouseEnter={() => setShowActions(true)}
        onMouseLeave={() => setShowActions(false)}
      >
        <div className="relative max-w-[80%]">
          {/* User actions */}
          {showActions && (
            <div className="absolute -left-20 top-1 flex items-center gap-1 animate-fade-in">
              <button
                onClick={handleCopy}
                className="p-1 rounded hover:bg-[var(--secondary)] transition-colors cursor-pointer"
                title="Copy"
              >
                {copied ? (
                  <Check className="w-3.5 h-3.5 text-[var(--success)]" />
                ) : (
                  <Copy className="w-3.5 h-3.5 text-[var(--muted-foreground)]" />
                )}
              </button>
              {onDelete && (
                <button
                  onClick={() => onDelete(message.id)}
                  className="p-1 rounded hover:bg-[var(--secondary)] transition-colors cursor-pointer"
                  title="Delete"
                >
                  <Trash2 className="w-3.5 h-3.5 text-[var(--muted-foreground)]" />
                </button>
              )}
            </div>
          )}
          <div className="rounded-2xl rounded-br-md px-4 py-3 text-sm bg-[var(--primary)] text-[var(--primary-foreground)] leading-relaxed">
            <div dir="auto">{message.content}</div>
            {/* Attachments (images, documents, etc.) */}
            {attachments.length > 0 && (
              <div className="flex flex-col gap-1">
                {attachments.map((a, i) => (
                  <AttachmentPreview key={i} attachment={a} />
                ))}
              </div>
            )}
          </div>
          <div className="text-[10px] text-[var(--muted-foreground)] mt-1 text-right opacity-0 group-hover:opacity-100 transition-opacity">
            {relativeTime}
          </div>
        </div>
      </div>
    );
  }

  // Assistant message
  return (
    <div
      className="flex gap-3 group"
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {/* Model avatar */}
      <div
        className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 text-white text-[10px] font-bold"
        style={{ backgroundColor: modelColor }}
      >
        {(model?.shortName ?? 'AI').charAt(0)}
      </div>

      {/* Message content */}
      <div className="flex-1 min-w-0">
        <div className="text-sm text-[var(--foreground)] leading-relaxed">
          <MarkdownRenderer content={message.content} />

          {/* Attachments (generated images, files, etc.) */}
          {attachments.length > 0 && (
            <div className="flex flex-col gap-1">
              {attachments.map((a, i) => (
                <div key={i}>
                  <AttachmentPreview attachment={a} />
                  {a.type?.startsWith('image') && a.data && (
                    <p className="text-xs text-[var(--muted-foreground)] mt-1">
                      Generated by Gemini Flash Image
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Actions bar */}
        <div
          className={`flex items-center gap-1 mt-1.5 transition-opacity ${
            showActions ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <button
            onClick={handleCopy}
            className="p-1 rounded hover:bg-[var(--secondary)] transition-colors cursor-pointer"
            title="Copy"
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-[var(--success)]" />
            ) : (
              <Copy className="w-3.5 h-3.5 text-[var(--muted-foreground)]" />
            )}
          </button>
          {onRegenerate && (
            <button
              onClick={() => onRegenerate(message.id)}
              className="p-1 rounded hover:bg-[var(--secondary)] transition-colors cursor-pointer"
              title="Regenerate"
            >
              <RefreshCw className="w-3.5 h-3.5 text-[var(--muted-foreground)]" />
            </button>
          )}
          {onDelete && (
            <button
              onClick={() => onDelete(message.id)}
              className="p-1 rounded hover:bg-[var(--secondary)] transition-colors cursor-pointer"
              title="Delete"
            >
              <Trash2 className="w-3.5 h-3.5 text-[var(--muted-foreground)]" />
            </button>
          )}
          <span className="text-[10px] text-[var(--muted-foreground)] ml-2">
            {model?.shortName ?? message.model} &middot; {relativeTime}
          </span>
        </div>
      </div>
    </div>
  );
});

function useRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
