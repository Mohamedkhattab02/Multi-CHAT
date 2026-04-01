'use client';

import { ErrorBoundary } from '@/components/layout/ErrorBoundary';
import { RotateCcw } from 'lucide-react';

export function SentryProvider({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary
      fallback={
        <div className="flex flex-col items-center justify-center min-h-screen text-center p-8 bg-[var(--background)]">
          <h1 className="text-2xl font-semibold text-[var(--foreground)] mb-2">
            Something went wrong
          </h1>
          <p className="text-[var(--muted-foreground)] mb-4">
            We&apos;ve been notified and will fix this soon.
          </p>
          <button
            className="inline-flex items-center gap-2 px-4 py-2 bg-[var(--primary)] text-[var(--primary-foreground)] rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
            onClick={() => window.location.reload()}
          >
            <RotateCcw className="w-4 h-4" />
            Reload page
          </button>
        </div>
      }
    >
      {children}
    </ErrorBoundary>
  );
}
