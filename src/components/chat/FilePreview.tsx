'use client';

import { X, FileText, Image, File } from 'lucide-react';
import type { Attachment } from '@/lib/supabase/types';

// ============================================================
// FilePreview — shows pending attachments before sending
// ============================================================

interface FilePreviewProps {
  attachments: PendingAttachment[];
  onRemove: (index: number) => void;
}

export interface PendingAttachment {
  file: File;
  previewUrl?: string;   // for images
  type: 'image' | 'pdf' | 'document';
}

function FileIcon({ type }: { type: string }) {
  if (type === 'image') return <Image size={16} className="text-blue-400" />;
  if (type === 'pdf') return <FileText size={16} className="text-red-400" />;
  return <File size={16} className="text-[var(--muted-foreground)]" />;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FilePreview({ attachments, onRemove }: FilePreviewProps) {
  if (attachments.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 px-3 pt-2">
      {attachments.map((att, i) => (
        <div
          key={i}
          className="group relative flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--secondary)] max-w-[180px]"
        >
          {/* Image thumbnail */}
          {att.type === 'image' && att.previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={att.previewUrl}
              alt={att.file.name}
              className="w-8 h-8 rounded object-cover flex-shrink-0"
            />
          ) : (
            <FileIcon type={att.type} />
          )}

          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium text-[var(--foreground)] truncate">
              {att.file.name}
            </p>
            <p className="text-[10px] text-[var(--muted-foreground)]">
              {formatFileSize(att.file.size)}
            </p>
          </div>

          {/* Remove button */}
          <button
            type="button"
            onClick={() => onRemove(i)}
            className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-[var(--foreground)] text-[var(--background)] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <X size={9} />
          </button>
        </div>
      ))}
    </div>
  );
}
