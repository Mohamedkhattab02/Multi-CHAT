'use client';

import { useState } from 'react';
import { Copy, Check, RefreshCw, Trash2 } from 'lucide-react';
import { formatRelativeTime } from '@/lib/utils/format';
import { MODELS, type ModelId } from '@/lib/utils/constants';
import { MarkdownRenderer } from './MarkdownRenderer';
import { ImagePreview } from './ImagePreview';
import type { Message } from '@/lib/supabase/types';
import type { Attachment } from '@/lib/supabase/types';

// ============================================================
// MessageBubble — single message with hover actions
// User: right-aligned with accent bg
// Assistant: left-aligned with model avatar, markdown rendered
// ============================================================

interface MessageBubbleProps {
  message: Message;
  onRegenerate?: (messageId: string) => void;
  onDelete?: (messageId: string) => void;
  isLast?: boolean;
}

function getModelAvatar(modelId: string): { initial: string; color: string } {
  const model = MODELS[modelId as ModelId];
  if (!model) return { initial: 'AI', color: '#737373' };
  return {
    initial: model.shortName.charAt(0),
    color: model.color,
  };
}

function extractImageUrls(content: string): string[] {
  const matches = content.match(/!\[.*?\]\((data:image[^)]+)\)/g) ?? [];
  return matches.map((m) => {
    const match = m.match(/\(([^)]+)\)/);
    return match?.[1] ?? '';
  }).filter(Boolean);
}

export function MessageBubble({ message, onRegenerate, onDelete, isLast }: MessageBubbleProps) {
  const [copied, setCopied] = useState(false);
  const [showActions, setShowActions] = useState(false);

  const isUser = message.role === 'user';
  const { initial, color } = getModelAvatar(message.model ?? '');

  const attachments: Attachment[] = Array.isArray(message.attachments)
    ? (message.attachments as unknown as Attachment[])
    : [];

  const generatedImages = extractImageUrls(message.content);
  // Content without embedded base64 image markdown
  const displayContent = message.content.replace(/!\[.*?\]\(data:image[^)]+\)/g, '').trim();

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard not available
    }
  };

  const timestamp = message.created_at
    ? formatRelativeTime(new Date(message.created_at))
    : '';

  if (isUser) {
    return (
      <div
        className="flex justify-end group"
        onMouseEnter={() => setShowActions(true)}
        onMouseLeave={() => setShowActions(false)}
      >
        <div className="max-w-[80%] space-y-1">
          {/* Attachments above the bubble */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 justify-end mb-1">
              {attachments.map((att, i) => (
                <div key={i} className="text-xs text-[var(--muted-foreground)] bg-[var(--secondary)] px-2 py-1 rounded-lg">
                  📎 {att.name}
                </div>
              ))}
            </div>
          )}

          <div className="rounded-2xl rounded-br-md px-4 py-3 text-sm bg-[var(--primary)] text-[var(--primary-foreground)] leading-relaxed"
            dir="auto"
          >
            {message.content}
          </div>

          {/* Timestamp + actions */}
          <div className={`flex items-center justify-end gap-2 transition-opacity ${showActions ? 'opacity-100' : 'opacity-0'}`}>
            <span className="text-[10px] text-[var(--muted-foreground)]">{timestamp}</span>
            <button
              onClick={handleCopy}
              className="p-1 rounded-md hover:bg-[var(--secondary)] text-[var(--muted-foreground)] transition-colors"
              title="Copy"
            >
              {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
            </button>
            {onDelete && (
              <button
                onClick={() => onDelete(message.id)}
                className="p-1 rounded-md hover:bg-red-500/10 text-[var(--muted-foreground)] hover:text-red-400 transition-colors"
                title="Delete"
              >
                <Trash2 size={12} />
              </button>
            )}
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
        style={{ backgroundColor: color }}
        title={message.model ?? 'AI'}
      >
        {initial}
      </div>

      <div className="flex-1 min-w-0">
        {/* Generated images */}
        {generatedImages.map((url, i) => (
          <ImagePreview key={i} imageUrl={url} />
        ))}

        {/* Markdown content */}
        {displayContent && (
          <div className="text-sm">
            <MarkdownRenderer content={displayContent} />
          </div>
        )}

        {/* Actions */}
        <div className={`flex items-center gap-2 mt-1.5 transition-opacity ${showActions ? 'opacity-100' : 'opacity-0'}`}>
          <span className="text-[10px] text-[var(--muted-foreground)]">{timestamp}</span>
          <button
            onClick={handleCopy}
            className="p-1 rounded-md hover:bg-[var(--secondary)] text-[var(--muted-foreground)] transition-colors"
            title="Copy"
          >
            {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
          </button>
          {onRegenerate && isLast && (
            <button
              onClick={() => onRegenerate(message.id)}
              className="p-1 rounded-md hover:bg-[var(--secondary)] text-[var(--muted-foreground)] transition-colors"
              title="Regenerate"
            >
              <RefreshCw size={12} />
            </button>
          )}
          {onDelete && (
            <button
              onClick={() => onDelete(message.id)}
              className="p-1 rounded-md hover:bg-red-500/10 text-[var(--muted-foreground)] hover:text-red-400 transition-colors"
              title="Delete"
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
