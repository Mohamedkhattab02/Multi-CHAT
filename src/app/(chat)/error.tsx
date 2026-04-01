'use client';

import { useEffect } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

export default function ChatError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Chat error:', error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center h-full p-8 text-center">
      <div className="w-12 h-12 rounded-full bg-[var(--destructive)]/10 flex items-center justify-center mb-4">
        <AlertTriangle className="w-6 h-6 text-[var(--destructive)]" />
      </div>
      <h2 className="text-lg font-semibold text-[var(--foreground)] mb-2">Something went wrong</h2>
      <p className="text-sm text-[var(--muted-foreground)] mb-5 max-w-sm">
        {error.message || 'An unexpected error occurred.'}
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
