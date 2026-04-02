'use client';

import { useState, useEffect, useCallback } from 'react';
import { Check, Copy } from 'lucide-react';

interface CodeBlockProps {
  code: string;
  language?: string;
}

export function CodeBlock({ code, language }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const [highlighted, setHighlighted] = useState<string>('');

  useEffect(() => {
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
        // Fallback: no highlighting
        if (!cancelled) setHighlighted('');
      }
    }

    highlight();
    return () => { cancelled = true; };
  }, [code, language]);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [code]);

  const lines = code.split('\n');
  const showLineNumbers = lines.length > 5;

  return (
    <div className="group relative my-3 rounded-lg overflow-hidden border border-[var(--border)] bg-[#0d1117]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#161b22] border-b border-[var(--border)]">
        <span className="text-xs text-gray-400 font-mono">
          {language || 'text'}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200 transition-colors cursor-pointer"
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
      </div>

      {/* Code body */}
      <div className="overflow-x-auto">
        {highlighted ? (
          <div className="flex">
            {showLineNumbers && (
              <div className="flex-shrink-0 py-4 pl-4 pr-2 text-right select-none">
                {lines.map((_, i) => (
                  <div key={i} className="text-xs leading-6 text-gray-600 font-mono">
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
                  <div key={i} className="text-xs leading-6 text-gray-600 font-mono">
                    {i + 1}
                  </div>
                ))}
              </div>
            )}
            <pre className="flex-1 py-4 px-4 overflow-x-auto text-sm leading-6 text-gray-200">
              <code>{code}</code>
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
