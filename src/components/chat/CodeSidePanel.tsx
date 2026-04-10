'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { X, Copy, Check, WrapText } from 'lucide-react';
import { useCodePanelStore, MIN_WIDTH, MAX_WIDTH } from '@/lib/store/code-panel-store';

export function CodeSidePanel() {
  const { isOpen, code, language, title, width, closePanel, setWidth } = useCodePanelStore();
  const [copied, setCopied] = useState(false);
  const [highlighted, setHighlighted] = useState('');
  const [wordWrap, setWordWrap] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Syntax highlight
  useEffect(() => {
    if (!isOpen || !code) {
      setHighlighted('');
      return;
    }

    let cancelled = false;
    async function highlight() {
      try {
        const { codeToHtml } = await import('shiki');
        const html = await codeToHtml(code, {
          lang: language || 'text',
          theme: 'github-dark-default',
        });
        if (!cancelled) setHighlighted(html);
      } catch {
        if (!cancelled) setHighlighted('');
      }
    }
    highlight();
    return () => { cancelled = true; };
  }, [code, language, isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePanel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, closePanel]);

  // ── Resize drag logic ──
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    startXRef.current = e.clientX;
    startWidthRef.current = width;
  }, [width]);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = startXRef.current - e.clientX;
      const newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidthRef.current + delta));
      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, [isResizing, setWidth]);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [code]);

  const lines = code.split('\n');

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop for mobile */}
      <div
        className="fixed inset-0 bg-black/30 backdrop-blur-[2px] z-40 lg:hidden"
        onClick={closePanel}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-[600px] lg:relative lg:z-auto lg:max-w-none border-l border-[var(--border)] flex flex-col"
        style={{
          backgroundColor: 'var(--code-bg)',
          animation: isResizing ? undefined : 'slide-in-right 0.2s ease-out',
        }}
      >
        {/* Resize handle — left edge (desktop only) */}
        <div
          onMouseDown={handleResizeStart}
          className="hidden lg:block absolute left-0 top-0 bottom-0 w-1 cursor-col-resize z-10 group"
        >
          <div className={`absolute left-0 top-0 bottom-0 w-1 transition-colors ${
            isResizing ? 'bg-[var(--primary)]' : 'bg-transparent hover:bg-[var(--primary)]/50'
          }`} />
        </div>

        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3 border-b"
          style={{ backgroundColor: 'var(--code-header-bg)', borderColor: 'var(--code-border)' }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span
              className="text-xs font-semibold px-2 py-0.5 rounded uppercase tracking-wide"
              style={{ backgroundColor: 'color-mix(in srgb, var(--model-accent) 20%, transparent)', color: 'var(--model-accent)' }}
            >
              {language || 'code'}
            </span>
            <span className="text-sm truncate" style={{ color: 'var(--code-fg)' }}>{title}</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setWordWrap(!wordWrap)}
              className="p-1.5 rounded-md transition-colors cursor-pointer"
              style={{ color: wordWrap ? 'var(--code-fg)' : 'var(--code-line-nr)' }}
              title="Toggle word wrap"
            >
              <WrapText className="w-4 h-4" />
            </button>
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs transition-colors cursor-pointer hover:opacity-80"
              style={{ color: 'var(--code-line-nr)' }}
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  Copy
                </>
              )}
            </button>
            <button
              onClick={closePanel}
              className="p-1.5 rounded-md transition-colors cursor-pointer hover:opacity-80"
              style={{ color: 'var(--code-line-nr)' }}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Code body */}
        <div className="flex-1 overflow-auto">
          <div className="flex min-h-full">
            {/* Line numbers */}
            <div
              className="flex-shrink-0 py-4 pl-4 pr-3 text-right select-none sticky left-0"
              style={{ backgroundColor: 'var(--code-bg)', color: 'var(--code-line-nr)' }}
            >
              {lines.map((_, i) => (
                <div key={i} className="text-xs leading-6 font-mono">
                  {i + 1}
                </div>
              ))}
            </div>

            {/* Code content */}
            {highlighted ? (
              <div
                className={`flex-1 py-4 px-4 text-sm leading-6 [&_pre]:!bg-transparent [&_pre]:!p-0 [&_pre]:!m-0 [&_code]:!bg-transparent ${
                  wordWrap ? '[&_pre]:!whitespace-pre-wrap [&_code]:!whitespace-pre-wrap break-words' : 'overflow-x-auto'
                }`}
                dangerouslySetInnerHTML={{ __html: highlighted }}
              />
            ) : (
              <pre
                className={`flex-1 py-4 px-4 text-sm leading-6 ${wordWrap ? 'whitespace-pre-wrap break-words' : 'overflow-x-auto'}`}
                style={{ color: 'var(--code-fg)' }}
              >
                <code>{code}</code>
              </pre>
            )}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes slide-in-right {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </>
  );
}
