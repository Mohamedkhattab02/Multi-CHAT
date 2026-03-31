'use client';

import { useSidebarStore } from '@/lib/store/sidebar-store';

const SUGGESTIONS = [
  { icon: '💡', text: 'Explain quantum computing in simple terms' },
  { icon: '🐛', text: 'Debug my JavaScript code' },
  { icon: '✍️', text: 'Write a professional email' },
  { icon: '📊', text: 'Analyze this data and give insights' },
];

export function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full p-8 text-center">
      <div className="mb-8 space-y-2">
        <h1 className="text-3xl font-semibold text-[var(--foreground)]">MultiChat AI</h1>
        <p className="text-[var(--muted-foreground)] text-sm max-w-xs">
          Chat with GPT, Gemini, and GLM — with memory that learns from you
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-md">
        {SUGGESTIONS.map((s) => (
          <button
            key={s.text}
            className="flex items-start gap-3 p-3 text-left rounded-xl border border-[var(--border)] hover:bg-[var(--secondary)] transition-colors text-sm"
          >
            <span className="text-xl flex-shrink-0">{s.icon}</span>
            <span className="text-[var(--foreground)] leading-snug">{s.text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
