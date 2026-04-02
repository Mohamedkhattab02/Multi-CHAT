'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { ChevronDown } from 'lucide-react';
import { MODELS, USER_SELECTABLE_MODELS, type ModelId } from '@/lib/utils/constants';

interface ModelSelectorProps {
  selectedModel: ModelId;
  onSelect: (model: ModelId) => void;
}

export function ModelSelector({ selectedModel, onSelect }: ModelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const currentModel = MODELS[selectedModel];

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen]);

  const handleSelect = useCallback(
    (model: ModelId) => {
      onSelect(model);
      setIsOpen(false);
    },
    [onSelect]
  );

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-[var(--secondary)] transition-colors text-sm cursor-pointer"
      >
        <span
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: currentModel?.color }}
        />
        <span className="text-[var(--foreground)] font-medium text-xs">
          {currentModel?.shortName ?? selectedModel}
        </span>
        <ChevronDown className="w-3 h-3 text-[var(--muted-foreground)]" />
      </button>

      {isOpen && (
        <div className="absolute bottom-full left-0 mb-1 w-52 rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-lg overflow-hidden animate-scale-in z-50">
          {USER_SELECTABLE_MODELS.map((modelId) => {
            const m = MODELS[modelId];
            const isSelected = modelId === selectedModel;

            return (
              <button
                key={modelId}
                onClick={() => handleSelect(modelId)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors cursor-pointer ${
                  isSelected
                    ? 'bg-[var(--sidebar-active)]'
                    : 'hover:bg-[var(--secondary)]'
                }`}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: m.color }}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-[var(--foreground)]">
                    {m.shortName}
                  </div>
                  <div className="text-[10px] text-[var(--muted-foreground)]">
                    {m.provider === 'openai'
                      ? 'OpenAI'
                      : m.provider === 'google'
                        ? 'Google'
                        : 'ZhipuAI'}
                  </div>
                </div>
                {isSelected && (
                  <span className="text-[var(--primary)] text-xs">✓</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
