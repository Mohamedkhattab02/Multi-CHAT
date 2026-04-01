'use client';

import { Lightbulb, Bug, PenLine, BarChart3, Sparkles } from 'lucide-react';

const SUGGESTIONS = [
  { icon: Lightbulb, text: 'Explain quantum computing in simple terms', color: 'var(--model-gpt)' },
  { icon: Bug, text: 'Debug my JavaScript code', color: 'var(--model-gemini)' },
  { icon: PenLine, text: 'Write a professional email', color: 'var(--model-glm)' },
  { icon: BarChart3, text: 'Analyze this data and give insights', color: 'var(--model-gemini)' },
];

export function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full p-8 text-center">
      <div className="mb-10 space-y-4 animate-fade-in-up">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[var(--primary)]/10 mb-2">
          <Sparkles className="w-8 h-8 text-[var(--primary)]" />
        </div>
        <h1 className="text-3xl font-bold gradient-text">MultiChat AI</h1>
        <p className="text-[var(--muted-foreground)] text-sm max-w-xs mx-auto leading-relaxed">
          Chat with GPT, Gemini, and GLM — powered by memory that learns from you
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-lg stagger-children">
        {SUGGESTIONS.map((s) => (
          <button
            key={s.text}
            className="flex items-start gap-3 p-4 text-left rounded-xl border border-[var(--border)] hover:border-[var(--primary)]/30 hover:bg-[var(--secondary)] transition-all duration-200 text-sm group cursor-pointer"
          >
            <div
              className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-transform duration-200 group-hover:scale-110"
              style={{ backgroundColor: `color-mix(in srgb, ${s.color} 12%, transparent)` }}
            >
              <s.icon className="w-4 h-4" style={{ color: s.color }} />
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
