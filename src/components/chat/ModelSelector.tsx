'use client';

import { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { MODELS, USER_SELECTABLE_MODELS, type ModelId } from '@/lib/utils/constants';
import { cn } from '@/lib/utils/cn';

// ============================================================
// ModelSelector — dropdown to pick GPT/Gemini/GLM
// Shows model icon + short name + color indicator
// ============================================================

interface ModelSelectorProps {
  value: ModelId;
  onChange: (model: ModelId) => void;
  disabled?: boolean;
  overrideBadge?: string | null;
}

export function ModelSelector({ value, onChange, disabled, overrideBadge }: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const currentModel = MODELS[value];

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      {/* Trigger button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] text-xs font-medium transition-all',
          'hover:border-[var(--ring)]/40 hover:bg-[var(--secondary)]',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          open && 'border-[var(--ring)]/40'
        )}
      >
        {/* Color dot */}
        <span
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: currentModel?.color ?? '#737373' }}
        />
        <span className="text-[var(--foreground)]">
          {currentModel?.shortName ?? value}
        </span>
        {overrideBadge && (
          <span className="text-[10px] text-[var(--muted-foreground)] ml-0.5">
            {overrideBadge}
          </span>
        )}
        <ChevronDown
          size={12}
          className={cn(
            'text-[var(--muted-foreground)] transition-transform',
            open && 'rotate-180'
          )}
        />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute bottom-full mb-1.5 left-0 z-50 w-48 rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-xl shadow-black/10 overflow-hidden animate-scale-in">
          <div className="p-1">
            {USER_SELECTABLE_MODELS.map((modelId) => {
              const model = MODELS[modelId];
              const isSelected = modelId === value;

              return (
                <button
                  key={modelId}
                  type="button"
                  onClick={() => {
                    onChange(modelId);
                    setOpen(false);
                  }}
                  className={cn(
                    'w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition-colors text-left',
                    isSelected
                      ? 'bg-[var(--secondary)] text-[var(--foreground)]'
                      : 'text-[var(--foreground)] hover:bg-[var(--secondary)]'
                  )}
                >
                  {/* Color indicator */}
                  <span
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: model.color }}
                  />
                  <div className="flex flex-col">
                    <span className="font-medium text-[13px]">{model.name}</span>
                    <span className="text-[10px] text-[var(--muted-foreground)] capitalize">
                      {model.provider}
                    </span>
                  </div>
                  {isSelected && (
                    <span className="ml-auto text-[10px] font-semibold" style={{ color: model.color }}>
                      ✓
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
