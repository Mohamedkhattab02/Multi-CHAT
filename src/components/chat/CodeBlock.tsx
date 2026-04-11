'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Check, Copy, Code2, ChevronRight, Eye } from 'lucide-react';
import { useCodePanelStore } from '@/lib/store/code-panel-store';

// Languages that support live preview in the side panel
const PREVIEWABLE_LANGUAGES = new Set([
  'html', 'svg', 'xml',
  'tsx', 'jsx',
  'css', 'scss', 'less',
  'md', 'markdown',
  'json',
  'mermaid',
]);

const COLLAPSE_THRESHOLD = 15; // lines

// Language display names and icons
const LANGUAGE_LABELS: Record<string, string> = {
  tsx: 'TypeScript JSX',
  jsx: 'JavaScript JSX',
  ts: 'TypeScript',
  js: 'JavaScript',
  html: 'HTML',
  css: 'CSS',
  scss: 'SCSS',
  python: 'Python',
  py: 'Python',
  java: 'Java',
  cpp: 'C++',
  c: 'C',
  go: 'Go',
  rust: 'Rust',
  rs: 'Rust',
  sql: 'SQL',
  json: 'JSON',
  yaml: 'YAML',
  yml: 'YAML',
  bash: 'Bash',
  sh: 'Shell',
  shell: 'Shell',
  xml: 'XML',
  md: 'Markdown',
  markdown: 'Markdown',
  graphql: 'GraphQL',
  php: 'PHP',
  ruby: 'Ruby',
  rb: 'Ruby',
  swift: 'Swift',
  kotlin: 'Kotlin',
  dart: 'Dart',
  vue: 'Vue',
  svelte: 'Svelte',
};


/** Extract a meaningful title from code (filename, component/function name, etc.) */
function extractCodeTitle(code: string, language?: string): string | null {
  // Look for filename patterns in comments (e.g., // filename.tsx or /* filename.css */)
  const fileCommentMatch = code.match(/^(?:\/\/|\/\*|#|<!--)\s*([a-zA-Z0-9_-]+\.[a-zA-Z0-9]+)/m);
  if (fileCommentMatch) return fileCommentMatch[1];

  // Look for export default function/class ComponentName
  const exportDefaultMatch = code.match(/export\s+default\s+(?:function|class)\s+(\w+)/);
  if (exportDefaultMatch) return exportDefaultMatch[1];

  // Look for export function ComponentName
  const exportFnMatch = code.match(/export\s+(?:function|const|class)\s+(\w+)/);
  if (exportFnMatch) return exportFnMatch[1];

  // Look for function ComponentName or const ComponentName
  const fnMatch = code.match(/^(?:function|const|class|interface|type|enum)\s+(\w+)/m);
  if (fnMatch) return fnMatch[1];

  // Look for React component patterns (const X = () =>)
  const arrowMatch = code.match(/(?:const|let)\s+(\w+)\s*=\s*\(?/);
  if (arrowMatch && arrowMatch[1][0] === arrowMatch[1][0].toUpperCase()) return arrowMatch[1];

  // Look for def function_name (Python)
  const pyMatch = code.match(/^def\s+(\w+)/m);
  if (pyMatch) return pyMatch[1];

  // Look for class ClassName
  const classMatch = code.match(/^class\s+(\w+)/m);
  if (classMatch) return classMatch[1];

  return null;
}

/** Detect if dark mode is active */
function useIsDarkMode() {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const check = () => setIsDark(document.documentElement.classList.contains('dark'));
    check();

    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return isDark;
}

interface CodeBlockProps {
  code: string;
  language?: string;
}

export function CodeBlock({ code, language }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const [highlighted, setHighlighted] = useState<string>('');
  const openPanel = useCodePanelStore((s) => s.openPanel);
  const isDark = useIsDarkMode();

  const lines = code.split('\n');
  const isLong = lines.length >= COLLAPSE_THRESHOLD;

  const codeTitle = useMemo(() => extractCodeTitle(code, language), [code, language]);
  const langLabel = language ? (LANGUAGE_LABELS[language] || language) : 'code';
  const canPreview = language ? PREVIEWABLE_LANGUAGES.has(language) : false;

  useEffect(() => {
    let cancelled = false;

    if (isLong) return;

    async function highlight() {
      try {
        const { codeToHtml } = await import('shiki');
        const html = await codeToHtml(code, {
          lang: language || 'text',
          theme: isDark ? 'github-dark-default' : 'github-light-default',
        });
        if (!cancelled) setHighlighted(html);
      } catch {
        if (!cancelled) setHighlighted('');
      }
    }

    highlight();
    return () => { cancelled = true; };
  }, [code, language, isLong, isDark]);

  const handleCopy = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [code]);

  const handleOpenInPanel = useCallback(() => {
    openPanel(code, language || 'text', codeTitle || langLabel);
  }, [code, language, codeTitle, langLabel, openPanel]);

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
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'color-mix(in srgb, var(--model-accent) 15%, transparent)' }}>
              <Code2 className="w-4 h-4" style={{ color: 'var(--model-accent)' }} />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-sm font-semibold truncate" style={{ color: 'var(--code-fg)' }}>
                {codeTitle || langLabel}
              </span>
              <div className="flex items-center gap-2">
                <span
                  className="text-[10px] font-medium px-1.5 py-0.5 rounded uppercase tracking-wider"
                  style={{ backgroundColor: 'color-mix(in srgb, var(--model-accent) 12%, transparent)', color: 'var(--model-accent)' }}
                >
                  {language || 'code'}
                </span>
                <span className="text-[10px]" style={{ color: 'var(--code-line-nr)' }}>
                  {lines.length} lines
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {canPreview && (
              <span
                className="flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full"
                style={{ backgroundColor: 'color-mix(in srgb, var(--model-accent) 12%, transparent)', color: 'var(--model-accent)' }}
              >
                <Eye className="w-3 h-3" />
                Preview
              </span>
            )}
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 text-xs transition-colors cursor-pointer hover:opacity-80"
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
        className="flex items-center justify-between px-4 py-2.5 border-b"
        style={{ backgroundColor: 'var(--code-header-bg)', borderColor: 'var(--code-border)' }}
      >
        <div className="flex items-center gap-2 min-w-0">
          {codeTitle && (
            <span className="text-xs font-semibold truncate" style={{ color: 'var(--code-fg)' }}>
              {codeTitle}
            </span>
          )}
          <span
            className="text-[10px] font-medium px-1.5 py-0.5 rounded uppercase tracking-wider flex-shrink-0"
            style={{ backgroundColor: 'color-mix(in srgb, var(--model-accent) 12%, transparent)', color: 'var(--model-accent)' }}
          >
            {language || 'text'}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {canPreview && (
            <button
              onClick={handleOpenInPanel}
              className="flex items-center gap-1 text-xs font-medium transition-colors cursor-pointer hover:opacity-80 px-1.5 py-0.5 rounded"
              style={{ color: 'var(--model-accent)', backgroundColor: 'color-mix(in srgb, var(--model-accent) 8%, transparent)' }}
              title="Open preview"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Preview</span>
            </button>
          )}
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