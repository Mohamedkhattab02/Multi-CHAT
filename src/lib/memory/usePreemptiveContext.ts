'use client';

import { useState, useEffect, useRef } from 'react';
/**
 * Preemptive context loader — fetches related memories while the user types.
 * Uses a server API route to generate embeddings (API keys are server-only).
 * 800ms debounce to avoid flooding.
 */
export function usePreemptiveContext(
  userId: string | null,
  conversationId: string | null,
  inputText: string
): string {
  const [context, setContext] = useState('');
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!userId || !conversationId || inputText.length < 10) {
      setContext('');
      return;
    }

    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(async () => {
      try {
        // Call server endpoint that handles embedding + search
        const res = await fetch('/api/memory/preemptive-search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: inputText, conversationId }),
        });

        if (!res.ok) return;

        const data = await res.json();
        if (data.results && data.results.length > 0) {
          setContext(
            data.results.map((r: any) => r.content).join('\n---\n')
          );
        } else {
          setContext('');
        }
      } catch (error) {
        console.error('[Preemptive] Error:', error);
      }
    }, 800);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [userId, conversationId, inputText]);

  return context;
}
