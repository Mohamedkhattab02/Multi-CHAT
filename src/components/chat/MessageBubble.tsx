'use client';

import { memo, useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Copy, Check, RefreshCw, Trash2, FileText, FileSpreadsheet, FileImage, File, Download, ExternalLink, X, ZoomIn } from 'lucide-react';
import { MODELS, type ModelId } from '@/lib/utils/constants';
import { MarkdownRenderer } from './MarkdownRenderer';
import { ModelAvatar } from './ModelAvatar';
import type { Message } from '@/lib/supabase/types';

interface AttachmentData {
  type?: string;
  data?: string;
  name?: string;
  url?: string;
  size?: number;
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

/* ───────────────────────── LIGHTBOX ───────────────────────── */

function ImageLightbox({
  imageUrl,
  name,
  onClose,
}: {
  imageUrl: string;
  name: string;
  onClose: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);

    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    const a = document.createElement('a');
    a.href = imageUrl;
    a.download = name || 'image';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div
      ref={overlayRef}
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.92)',
        backdropFilter: 'blur(12px)',
        animation: 'lb-fade-in .2s ease-out',
      }}
    >
      <style>{`
        @keyframes lb-fade-in { from { opacity:0 } to { opacity:1 } }
        @keyframes lb-scale-in { from { opacity:0; transform:scale(.94) } to { opacity:1; transform:scale(1) } }
      `}</style>

      {/* Close button — top right */}
      <button
        onClick={onClose}
        style={{
          position: 'absolute',
          top: 16,
          right: 16,
          width: 40,
          height: 40,
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.1)',
          border: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          zIndex: 10,
          transition: 'background .15s',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.2)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.1)')}
      >
        <X style={{ width: 20, height: 20, color: '#fff' }} />
      </button>

      {/* Image — fit to viewport */}
      <div
        style={{
          maxWidth: '90vw',
          maxHeight: '85vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          animation: 'lb-scale-in .25s ease-out',
        }}
      >
        <img
          src={imageUrl}
          alt={name || 'Image'}
          draggable={false}
          onLoad={() => setLoaded(true)}
          style={{
            maxWidth: '100%',
            maxHeight: '85vh',
            objectFit: 'contain',
            borderRadius: 12,
            boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
            display: 'block',
          }}
        />
      </div>

      {/* Bottom toolbar */}
      {loaded && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginTop: 16,
            animation: 'lb-fade-in .3s ease-out',
          }}
        >
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginRight: 8, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {name || 'Image'}
          </span>
          <button
            onClick={handleDownload}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '6px 14px', borderRadius: 8,
              background: 'rgba(255,255,255,0.1)', border: 'none',
              color: 'rgba(255,255,255,0.8)', fontSize: 12,
              cursor: 'pointer', transition: 'background .15s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.2)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.1)')}
          >
            <Download style={{ width: 14, height: 14 }} /> Save
          </button>
          <a
            href={imageUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '6px 14px', borderRadius: 8,
              background: 'rgba(255,255,255,0.1)', border: 'none',
              color: 'rgba(255,255,255,0.8)', fontSize: 12, textDecoration: 'none',
              cursor: 'pointer', transition: 'background .15s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.2)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.1)')}
          >
            <ExternalLink style={{ width: 14, height: 14 }} /> Open
          </a>
        </div>
      )}
    </div>
  );
}

/* ───────────────── IMAGE THUMBNAIL (small, clickable) ───────────────── */

function ImageThumbnail({ attachment }: { attachment: AttachmentData }) {
  const [expanded, setExpanded] = useState(false);
  const imageUrl = attachment.url || (attachment.data ? `data:${attachment.type};base64,${attachment.data}` : null);

  if (!imageUrl) return null;

  return (
    <>
      <div
        className="relative group/img cursor-pointer"
        onClick={() => setExpanded(true)}
        style={{
          width: 200,
          height: 140,
          borderRadius: 10,
          overflow: 'hidden',
          flexShrink: 0,
          border: '1px solid var(--border)',
        }}
      >
        <img
          src={imageUrl}
          alt={attachment.name || 'attachment'}
          loading="lazy"
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
          }}
        />
        {/* Hover overlay */}
        <div
          style={{
            position: 'absolute', inset: 0,
            background: 'rgba(0,0,0,0)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'background .15s',
            pointerEvents: 'none',
          }}
          className="group-hover/img:!bg-black/30"
        >
          <div
            style={{
              opacity: 0, background: 'rgba(0,0,0,0.55)', borderRadius: '50%',
              width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'opacity .15s',
            }}
            className="group-hover/img:!opacity-100"
          >
            <ZoomIn style={{ width: 18, height: 18, color: '#fff' }} />
          </div>
        </div>
        {/* File name label at bottom */}
        {attachment.name && (
          <div
            style={{
              position: 'absolute', bottom: 0, left: 0, right: 0,
              padding: '14px 8px 5px',
              background: 'linear-gradient(transparent, rgba(0,0,0,0.55))',
              pointerEvents: 'none',
            }}
          >
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.9)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
              {attachment.name}
            </span>
          </div>
        )}
      </div>

      {expanded && createPortal(
        <ImageLightbox
          imageUrl={imageUrl}
          name={attachment.name || 'image'}
          onClose={() => setExpanded(false)}
        />,
        document.body
      )}
    </>
  );
}

/* ───────────────── FILE ATTACHMENT (non-image) ───────────────── */

function FileAttachmentPreview({ attachment }: { attachment: AttachmentData }) {
  const fileColor = getFileColor(attachment.type || '');
  const fileExt = getFileExtension(attachment.name || 'file');

  const inner = (
    <>
      <div
        style={{
          width: 40, height: 40, borderRadius: 8,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          backgroundColor: fileColor, color: '#fff',
          fontSize: 10, fontWeight: 700, flexShrink: 0,
        }}
      >
        {fileExt}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p className="text-xs font-medium text-[var(--foreground)] truncate">
          {attachment.name || 'File'}
        </p>
        <p className="text-[10px] text-[var(--muted-foreground)]">
          {formatFileSize(attachment.size)}
          {attachment.url && <> &middot; Click to open</>}
        </p>
      </div>
    </>
  );

  if (attachment.url) {
    return (
      <a
        href={attachment.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-3 px-4 py-3 rounded-xl border border-[var(--border)] bg-[var(--secondary)]/30 hover:bg-[var(--secondary)]/60 transition-colors max-w-[300px]"
      >
        {inner}
      </a>
    );
  }

  return (
    <div className="inline-flex items-center gap-3 px-4 py-3 rounded-xl border border-[var(--border)] bg-[var(--secondary)]/30 max-w-[300px]">
      {inner}
    </div>
  );
}

/* ───────────────── MESSAGE BUBBLE ───────────────── */

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

  const attachments = (message.attachments || []) as AttachmentData[];
  const imageAttachments = attachments.filter((a) => a.type?.startsWith('image/'));
  const fileAttachments = attachments.filter((a) => !a.type?.startsWith('image/'));

  /* ── USER MESSAGE ── */
  if (message.role === 'user') {
    return (
      <div
        className="flex justify-end group"
        onMouseEnter={() => setShowActions(true)}
        onMouseLeave={() => setShowActions(false)}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, maxWidth: '80%', position: 'relative' }}>
          {/* Hover actions */}
          {showActions && (
            <div className="absolute -left-20 top-1 flex items-center gap-1 animate-fade-in" style={{ zIndex: 2 }}>
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

          {/* Image thumbnails — ABOVE the text bubble, small fixed-size cards */}
          {imageAttachments.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'flex-end' }}>
              {imageAttachments.map((a, i) => (
                <ImageThumbnail key={`img-${i}`} attachment={a} />
              ))}
            </div>
          )}

          {/* Text bubble */}
          {message.content && (
            <div
              className="rounded-2xl rounded-br-md px-4 py-3 text-sm leading-relaxed"
              style={{ overflow: 'hidden', wordBreak: 'break-word', backgroundColor: 'var(--user-bubble-bg)', color: 'var(--user-bubble-fg)' }}
            >
              <div dir="auto">{message.content}</div>
            </div>
          )}

          {/* File attachments — no bubble background */}
          {fileAttachments.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {fileAttachments.map((a, i) => (
                <FileAttachmentPreview key={`file-${i}`} attachment={a} />
              ))}
            </div>
          )}

          <div className="text-[10px] text-[var(--muted-foreground)] text-right opacity-0 group-hover:opacity-100 transition-opacity">
            {relativeTime}
          </div>
        </div>
      </div>
    );
  }

  /* ── ASSISTANT MESSAGE ── */
  return (
    <div
      className="flex gap-3 group"
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {/* Model avatar */}
      <div className="mt-0.5">
        <ModelAvatar model={message.model ?? ''} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="text-sm text-[var(--foreground)] leading-relaxed">
          <MarkdownRenderer content={message.content} />

          {/* Attachments */}
          {attachments.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
              {imageAttachments.map((a, i) => (
                <div key={`img-${i}`}>
                  <ImageThumbnail attachment={a} />
                  {a.data && (
                    <p className="text-xs text-[var(--muted-foreground)] mt-1">
                      Generated by Gemini Flash Image
                    </p>
                  )}
                </div>
              ))}
              {fileAttachments.map((a, i) => (
                <FileAttachmentPreview key={`file-${i}`} attachment={a} />
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