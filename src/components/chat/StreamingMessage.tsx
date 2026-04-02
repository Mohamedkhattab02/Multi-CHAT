'use client';

import { MODELS, type ModelId } from '@/lib/utils/constants';
import { MarkdownRenderer } from './MarkdownRenderer';

// ============================================================
// StreamingMessage — live token-by-token streaming display
// Shows blinking cursor while streaming
// ============================================================

interface StreamingMessageProps {
  content: string;
  model: string;
}

export function StreamingMessage({ content, model }: StreamingMessageProps) {
  const modelConfig = MODELS[model as ModelId];
  const color = modelConfig?.color ?? '#737373';
  const initial = modelConfig?.shortName?.charAt(0) ?? 'A';

  return (
    <div className="flex gap-3 animate-fade-in">
      {/* Model avatar */}
      <div
        className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 text-white text-[10px] font-bold"
        style={{ backgroundColor: color }}
      >
        {initial}
      </div>

      <div className="flex-1 min-w-0 text-sm">
        {content ? (
          <div className="relative">
            <MarkdownRenderer content={content} />
            {/* Blinking cursor at the end */}
            <span className="inline-block w-0.5 h-4 bg-[var(--foreground)] ml-0.5 animate-pulse-subtle align-middle" />
          </div>
        ) : (
          /* Thinking indicator — 3 dots */
          <div className="flex items-center gap-1 py-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--muted-foreground)] animate-bounce [animation-delay:0ms]" />
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--muted-foreground)] animate-bounce [animation-delay:150ms]" />
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--muted-foreground)] animate-bounce [animation-delay:300ms]" />
          </div>
        )}
      </div>
    </div>
  );
}
