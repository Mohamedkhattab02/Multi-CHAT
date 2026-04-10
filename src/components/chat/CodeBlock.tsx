'use client';

import { useState, useEffect, useCallback } from 'react';
import { Check, Copy, Code2, ChevronRight } from 'lucide-react';
import { useCodePanelStore } from '@/lib/store/code-panel-store';

const COLLAPSE_THRESHOLD = 15; // lines

interface CodeBlockProps {
  code: string;
  language?: string;
}

export function CodeBlock({ code, language }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const [highlighted, setHighlighted] = useState<string>('');
  const openPanel = useCodePanelStore((s) => s.openPanel);

  const lines = code.split('\n');
  const isLong = lines.length >= COLLAPSE_THRESHOLD;

  useEffect(() => {
    let cancelled = false;

    if (isLong) return;

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
  }, [code, language, isLong]);

  const handleCopy = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [code]);

  const handleOpenInPanel = useCallback(() => {
    openPanel(code, language || 'text', language || 'Code');
  }, [code, language, openPanel]);

  const showLineNumbers = lines.length > 5;

  // ── Long code: show as a compact clickable card ──
  if (isLong) {
    return (
      <div
        onClick={handleOpenInPanel}
        className="group my-3 rounded-lg border overflow-hidden cursor-pointer transition-all hover:border-[var(--ring)]"
        style={{ borderColor: 'var(--code-border)', backgroundColor: 'var(--code-bg)' }}
      >
        {/* Card header */}
        <div
          className="flex items-center justify-between px-4 py-2.5 border-b"
          style={{ backgroundColor: 'var(--code-header-bg)', borderColor: 'var(--code-border)' }}
        >
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ backgroundColor: 'color-mix(in srgb, var(--model-accent) 15%, transparent)' }}>
              <Code2 className="w-4 h-4" style={{ color: 'var(--model-accent)' }} />
            </div>
            <div className="flex flex-col">
              <span className="text-xs font-medium" style={{ color: 'var(--code-fg)' }}>
                {language || 'code'}
              </span>
              <span className="text-[10px]" style={{ color: 'var(--code-line-nr)' }}>
                {lines.length} lines
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 text-xs transition-colors cursor-pointer"
              style={{ color: 'var(--code-line-nr)' }}
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy</span>
                </>
              )}
            </button>
            <ChevronRight className="w-4 h-4 group-hover:translate-x-0.5 transition-all" style={{ color: 'var(--code-line-nr)' }} />
          </div>
        </div>

        {/* Preview: first few lines dimmed */}
        <div className="px-4 py-2.5 max-h-[72px] overflow-hidden relative">
          <pre className="text-xs leading-5 font-mono truncate" style={{ color: 'var(--code-line-nr)' }}>
            {lines.slice(0, 3).map((line, i) => (
              <div key={i} className="truncate">{line || ' '}</div>
            ))}
          </pre>
          <div className="absolute bottom-0 left-0 right-0 h-8" style={{ background: `linear-gradient(transparent, var(--code-bg))` }} />
        </div>
      </div>
    );
  }

  // ── Short code: render inline ──
  return (
    <div
      className="group relative my-3 rounded-lg overflow-hidden border"
      style={{ borderColor: 'var(--code-border)', backgroundColor: 'var(--code-bg)' }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-2 border-b"
        style={{ backgroundColor: 'var(--code-header-bg)', borderColor: 'var(--code-border)' }}
      >
        <span className="text-xs font-mono" style={{ color: 'var(--code-line-nr)' }}>
          {language || 'text'}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 text-xs transition-colors cursor-pointer hover:opacity-80"
            style={{ color: 'var(--code-line-nr)' }}
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5" />
                <span>Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Copy</span>
              </>
            )}
          </button>
          <button
            onClick={handleOpenInPanel}
            className="flex items-center gap-1 text-xs transition-colors cursor-pointer hover:opacity-80"
            style={{ color: 'var(--code-line-nr)' }}
            title="Open in side panel"
          >
            <Code2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Code body */}
      <div className="overflow-x-auto">
        {highlighted ? (
          <div className="flex">
            {showLineNumbers && (
              <div className="flex-shrink-0 py-4 pl-4 pr-2 text-right select-none">
                {lines.map((_, i) => (
                  <div key={i} className="text-xs leading-6 font-mono" style={{ color: 'var(--code-line-nr)' }}>
                    {i + 1}
                  </div>
                ))}
              </div>
            )}
            <div
              className="flex-1 py-4 px-4 overflow-x-auto text-sm leading-6 [&_pre]:!bg-transparent [&_pre]:!p-0 [&_pre]:!m-0 [&_code]:!bg-transparent"
              dangerouslySetInnerHTML={{ __html: highlighted }}
            />
          </div>
        ) : (
          <div className="flex">
            {showLineNumbers && (
              <div className="flex-shrink-0 py-4 pl-4 pr-2 text-right select-none">
                {lines.map((_, i) => (
                  <div key={i} className="text-xs leading-6 font-mono" style={{ color: 'var(--code-line-nr)' }}>
                    {i + 1}
                  </div>
                ))}
              </div>
            )}
            <pre className="flex-1 py-4 px-4 overflow-x-auto text-sm leading-6" style={{ color: 'var(--code-fg)' }}>
              <code>{code}</code>
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
