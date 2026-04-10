'use client';

import { memo, useMemo, lazy, Suspense } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { sanitizeHtmlSync } from '@/lib/security/sanitize';

// Lazy-load CodeBlock (pulls in Shiki ~2MB) — only loaded when code blocks appear
const CodeBlock = lazy(() =>
  import('./CodeBlock').then((m) => ({ default: m.CodeBlock }))
);

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
  className = '',
}: MarkdownRendererProps) {
  const sanitized = useMemo(() => sanitizeHtmlSync(content), [content]);

  return (
    <div className={`markdown-body ${className}`} dir="auto">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          // Code blocks with syntax highlighting
          code({ className: codeClassName, children, ...props }) {
            const match = /language-(\w+)/.exec(codeClassName || '');
            const codeString = String(children).replace(/\n$/, '');

            // Inline code vs block code
            const isInline = !match && !codeString.includes('\n');
            if (isInline) {
              return (
                <code
                  className="px-1.5 py-0.5 rounded-md bg-[var(--secondary)] text-[var(--foreground)] text-[0.875em] font-mono"
                  {...props}
                >
                  {children}
                </code>
              );
            }

            return (
              <Suspense fallback={<pre className="my-3 p-4 rounded-lg text-sm overflow-x-auto" style={{ backgroundColor: 'var(--code-bg)', color: 'var(--code-fg)' }}><code>{codeString}</code></pre>}>
                <CodeBlock code={codeString} language={match?.[1]} />
              </Suspense>
            );
          },

          // Links
          a({ href, children }) {
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--primary)] hover:underline"
              >
                {children}
              </a>
            );
          },

          // Tables
          table({ children }) {
            return (
              <div className="overflow-x-auto my-3">
                <table className="w-full border-collapse text-sm">
                  {children}
                </table>
              </div>
            );
          },
          th({ children }) {
            return (
              <th className="border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-left font-semibold text-[var(--foreground)]">
                {children}
              </th>
            );
          },
          td({ children }) {
            return (
              <td className="border border-[var(--border)] px-3 py-2 text-[var(--foreground)]">
                {children}
              </td>
            );
          },

          // Blockquotes
          blockquote({ children }) {
            return (
              <blockquote className="border-l-4 border-[var(--primary)] pl-4 my-3 text-[var(--muted-foreground)] italic">
                {children}
              </blockquote>
            );
          },

          // Headings
          h1({ children }) {
            return <h1 className="text-xl font-bold mt-6 mb-3 text-[var(--foreground)]">{children}</h1>;
          },
          h2({ children }) {
            return <h2 className="text-lg font-bold mt-5 mb-2 text-[var(--foreground)]">{children}</h2>;
          },
          h3({ children }) {
            return <h3 className="text-base font-semibold mt-4 mb-2 text-[var(--foreground)]">{children}</h3>;
          },

          // Paragraphs
          p({ children }) {
            return <p className="my-2 leading-relaxed">{children}</p>;
          },

          // Lists
          ul({ children }) {
            return <ul className="my-2 pl-6 list-disc space-y-1">{children}</ul>;
          },
          ol({ children }) {
            return <ol className="my-2 pl-6 list-decimal space-y-1">{children}</ol>;
          },
          li({ children }) {
            return <li className="leading-relaxed">{children}</li>;
          },

          // Horizontal rule
          hr() {
            return <hr className="my-4 border-[var(--border)]" />;
          },

          // Images
          img({ src, alt }) {
            return (
              <img
                src={src}
                alt={alt || ''}
                className="max-w-[400px] rounded-lg my-3 border border-[var(--border)]"
                loading="lazy"
              />
            );
          },
        }}
      >
        {sanitized}
      </ReactMarkdown>
    </div>
  );
});
