'use client';

import { useEffect, lazy, Suspense } from 'react';
import { useKeyboardShortcuts } from '@/lib/hooks/use-keyboard-shortcuts';
import { useUiStore } from '@/lib/store/ui-store';

// Lazy-load heavy overlay components — only downloaded when opened
const CommandPalette = lazy(() =>
  import('@/components/CommandPalette').then((m) => ({ default: m.CommandPalette }))
);
const ShareDialog = lazy(() =>
  import('@/components/ShareDialog').then((m) => ({ default: m.ShareDialog }))
);

export function GlobalOverlays() {
  useKeyboardShortcuts();

  const { isMobile, setMobile, isCommandPaletteOpen, isShareDialogOpen } = useUiStore();

  // Detect mobile viewport
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    setMobile(mq.matches);

    function onChange(e: MediaQueryListEvent) {
      setMobile(e.matches);
    }
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [setMobile]);

  return (
    <Suspense fallback={null}>
      {isCommandPaletteOpen && <CommandPalette />}
      {isShareDialogOpen && <ShareDialog />}
    </Suspense>
  );
}
