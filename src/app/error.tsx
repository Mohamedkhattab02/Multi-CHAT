'use client';

import { useEffect } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Global error:', error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-8 text-center bg-[var(--background)]">
      <div className="w-14 h-14 rounded-full bg-[var(--destructive)]/10 flex items-center justify-center mb-5">
        <AlertTriangle className="w-7 h-7 text-[var(--destructive)]" />
      </div>
      <h1 className="text-xl font-semibold text-[var(--foreground)] mb-2">Something went wrong</h1>
      <p className="text-sm text-[var(--muted-foreground)] mb-6 max-w-sm">
        {error.message || 'An unexpected error occurred. Please try again.'}
      </p>
      <button
        onClick={reset}
        className="inline-flex items-center gap-2 px-4 py-2 bg-[var(--primary)] text-[var(--primary-foreground)] rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
      >
        <RotateCcw className="w-4 h-4" />
        Try again
      </button>
    </div>
  );
}
