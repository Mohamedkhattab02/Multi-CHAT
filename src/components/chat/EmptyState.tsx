'use client';

import { Lightbulb, Bug, PenLine, BarChart3, Sparkles } from 'lucide-react';
import { useChatStore } from '@/lib/store/chat-store';
import { MODELS, type ModelId } from '@/lib/utils/constants';

const SUGGESTIONS = [
  { icon: Lightbulb, text: 'Explain quantum computing in simple terms' },
  { icon: Bug, text: 'Debug my JavaScript code' },
  { icon: PenLine, text: 'Write a professional email' },
  { icon: BarChart3, text: 'Analyze this data and give insights' },
];

const PROVIDER_LABELS: Record<string, { greeting: string; subtitle: string }> = {
  google: {
    greeting: 'Hello, I\'m Gemini',
    subtitle: 'Powered by Google — fast, creative, and multimodal',
  },
  openai: {
    greeting: 'Hello, I\'m ChatGPT',
    subtitle: 'Powered by OpenAI — intelligent and versatile',
  },
  zhipu: {
    greeting: 'Hello, I\'m GLM',
    subtitle: 'Powered by ZhipuAI — bilingual and efficient',
  },
};

interface EmptyStateProps {
  onSuggestionClick?: (text: string) => void;
}

export function EmptyState({ onSuggestionClick }: EmptyStateProps = {}) {
  const selectedModel = useChatStore((s) => s.selectedModel);
  const model = MODELS[selectedModel as ModelId];
  const provider = model?.provider ?? 'google';
  const labels = PROVIDER_LABELS[provider] ?? PROVIDER_LABELS.google;

  return (
    <div className="flex flex-col items-center justify-center h-full p-8 text-center">
      <div className="mb-10 space-y-4 animate-fade-in-up">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-2" style={{ backgroundColor: 'color-mix(in srgb, var(--model-accent) 12%, transparent)' }}>
          <Sparkles className="w-8 h-8" style={{ color: 'var(--model-accent)' }} />
        </div>
        <h1 className="text-3xl font-bold" style={{ color: 'var(--model-accent)' }}>
          {labels.greeting}
        </h1>
        <p className="text-[var(--muted-foreground)] text-sm max-w-xs mx-auto leading-relaxed">
          {labels.subtitle}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-lg stagger-children">
        {SUGGESTIONS.map((s) => (
          <button
            key={s.text}
            onClick={() => onSuggestionClick?.(s.text)}
            className="flex items-start gap-3 p-4 text-left rounded-xl border border-[var(--border)] hover:border-[var(--primary)]/30 hover:bg-[var(--secondary)] transition-all duration-200 text-sm group cursor-pointer"
          >
            <div
              className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-transform duration-200 group-hover:scale-110"
              style={{ backgroundColor: 'color-mix(in srgb, var(--model-accent) 12%, transparent)' }}
            >
              <s.icon className="w-4 h-4" style={{ color: 'var(--model-accent)' }} />
            </div>
            <span className="text-[var(--foreground)] leading-snug pt-1">{s.text}</span>
          </button>
        ))}
      </div>

      <p className="mt-8 text-xs text-[var(--muted-foreground)]">
        Choose a suggestion above or start typing below
      </p>
    </div>
  );
}
