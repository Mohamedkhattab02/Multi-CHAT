'use client';

import { memo } from 'react';
import { MODELS, type ModelId } from '@/lib/utils/constants';
import { MarkdownRenderer } from './MarkdownRenderer';
import { Square } from 'lucide-react';
import type { StreamingStatus } from '@/lib/store/chat-store';

interface StreamingMessageProps {
  content: string;
  model: string;
  routeOverride?: string | null;
  streamingStatus?: StreamingStatus;
  streamingStatusDetail?: string | null;
  onStop: () => void;
}

const STATUS_LABELS: Record<StreamingStatus, { he: string; en: string }> = {
  idle: { he: 'מתחבר...', en: 'Connecting...' },
  uploading: { he: 'שולח...', en: 'Sending...' },
  classifying: { he: 'מנתח את ההודעה...', en: 'Analyzing message...' },
  searching_memory: { he: 'מחפש בזיכרון ובמסמכים...', en: 'Searching memory & documents...' },
  generating: { he: 'כותב תשובה...', en: 'Writing response...' },
  processing: { he: 'מעבד...', en: 'Processing...' },
  extracting_document: { he: 'מחלץ טקסט מהמסמך...', en: 'Extracting document text...' },
  extracting_pages: { he: 'קורא עמודים...', en: 'Reading pages...' },
  analyzing_images: { he: 'מנתח תמונות מוטמעות...', en: 'Analyzing embedded images...' },
};

function getStatusLabel(status: StreamingStatus): string {
  const labels = STATUS_LABELS[status] || STATUS_LABELS.idle;
  // Detect language preference from document direction
  if (typeof document !== 'undefined') {
    const dir = document.documentElement.dir || document.documentElement.getAttribute('dir');
    if (dir === 'rtl') return labels.he;
  }
  return labels.he; // Default to Hebrew since this is a Hebrew-primary app
}

export const StreamingMessage = memo(function StreamingMessage({
  content,
  model,
  routeOverride,
  streamingStatus = 'idle',
  streamingStatusDetail,
  onStop,
}: StreamingMessageProps) {
  const modelInfo = MODELS[model as ModelId];
  const modelColor = modelInfo?.color ?? '#737373';

  const displayModel = routeOverride
    ? MODELS[routeOverride as ModelId]
    : modelInfo;

  return (
    <div className="flex gap-3">
      {/* Model avatar */}
      <div
        className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 text-white text-[10px] font-bold"
        style={{ backgroundColor: displayModel?.color ?? modelColor }}
      >
        {(displayModel?.shortName ?? 'AI').charAt(0)}
      </div>

      {/* Streaming content */}
      <div className="flex-1 min-w-0">
        {/* Route override badge */}
        {routeOverride && routeOverride !== model && (
          <div className="mb-1">
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--secondary)] text-[var(--muted-foreground)]">
              {routeOverride.includes('flash-image')
                ? '🎨 via Gemini Image'
                : '🔍 via Gemini Flash'}
            </span>
          </div>
        )}

        <div className="text-sm text-[var(--foreground)] leading-relaxed">
          {content ? (
            <div className="streaming-cursor">
              <MarkdownRenderer content={content} />
            </div>
          ) : (
            <div className="flex items-center gap-2 text-[var(--muted-foreground)]">
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--muted-foreground)] animate-pulse-subtle" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--muted-foreground)] animate-pulse-subtle" style={{ animationDelay: '200ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--muted-foreground)] animate-pulse-subtle" style={{ animationDelay: '400ms' }} />
              </div>
              <span className="text-xs">
                {getStatusLabel(streamingStatus)}
                {streamingStatusDetail ? ` (${streamingStatusDetail})` : ''}
              </span>
            </div>
          )}
        </div>

        {/* Stop button */}
        <button
          onClick={onStop}
          className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-[var(--muted-foreground)] hover:bg-[var(--secondary)] transition-colors cursor-pointer"
        >
          <Square className="w-3 h-3 fill-current" />
          Stop generating
        </button>
      </div>
    </div>
  );
});
