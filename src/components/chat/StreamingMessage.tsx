'use client';

import { memo } from 'react';
import { MODELS, type ModelId } from '@/lib/utils/constants';
import { MarkdownRenderer } from './MarkdownRenderer';
import { Square } from 'lucide-react';

interface StreamingMessageProps {
  content: string;
  model: string;
  routeOverride?: string | null;
  onStop: () => void;
}

export const StreamingMessage = memo(function StreamingMessage({
  content,
  model,
  routeOverride,
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
              <span className="text-xs">Thinking...</span>
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
