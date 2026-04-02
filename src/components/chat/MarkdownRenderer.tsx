'use client';

import { useMemo, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { sanitizeHtml } from '@/lib/security/sanitize';
import { CodeBlock } from './CodeBlock';

// ============================================================
// MarkdownRenderer — full GFM + math + code + DOMPurify
// All HTML sanitized before render. KaTeX for math.
// ============================================================

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export function MarkdownRenderer({ content, className = '' }: MarkdownRendererProps) {
  const [sanitizedContent, setSanitizedContent] = useState(content);

  useEffect(() => {
    // Async sanitize (DOMPurify requires browser)
    sanitizeHtml(content).then(setSanitizedContent);
  }, [content]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const components = useMemo((): any => ({
    // Code blocks and inline code
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    code({ node, className: cls, children, ...props }: any) {
      const inline = !cls?.startsWith('language-');
      const match = /language-(\w+)/.exec(cls ?? '');
      const lang = match?.[1] ?? 'text';
      const codeString = String(children).replace(/\n$/, '');

      if (inline) {
        return (
          <code
            className="px-1.5 py-0.5 rounded-md text-[13px] font-mono bg-[var(--secondary)] text-[var(--foreground)] border border-[var(--border)]"
            {...props}
          >
            {codeString}
          </code>
        );
      }

      return <CodeBlock code={codeString} language={lang} />;
    },

    // Paragraphs
    p({ children }: { children: React.ReactNode }) {
      return <p className="mb-3 last:mb-0 leading-7">{children}</p>;
    },

    // Headings
    h1({ children }: { children: React.ReactNode }) {
      return <h1 className="text-xl font-bold mb-3 mt-4 first:mt-0">{children}</h1>;
    },
    h2({ children }: { children: React.ReactNode }) {
      return <h2 className="text-lg font-semibold mb-2 mt-4 first:mt-0">{children}</h2>;
    },
    h3({ children }: { children: React.ReactNode }) {
      return <h3 className="text-base font-semibold mb-2 mt-3 first:mt-0">{children}</h3>;
    },

    // Lists
    ul({ children }: { children: React.ReactNode }) {
      return <ul className="mb-3 pl-5 space-y-1 list-disc">{children}</ul>;
    },
    ol({ children }: { children: React.ReactNode }) {
      return <ol className="mb-3 pl-5 space-y-1 list-decimal">{children}</ol>;
    },
    li({ children }: { children: React.ReactNode }) {
      return <li className="leading-7">{children}</li>;
    },

    // Blockquote
    blockquote({ children }: { children: React.ReactNode }) {
      return (
        <blockquote className="border-l-2 border-[var(--ring)] pl-4 text-[var(--muted-foreground)] italic my-3">
          {children}
        </blockquote>
      );
    },

    // Tables (GFM)
    table({ children }: { children: React.ReactNode }) {
      return (
        <div className="overflow-x-auto my-3">
          <table className="w-full text-sm border-collapse border border-[var(--border)] rounded-lg overflow-hidden">
            {children}
          </table>
        </div>
      );
    },
    thead({ children }: { children: React.ReactNode }) {
      return <thead className="bg-[var(--secondary)]">{children}</thead>;
    },
    th({ children }: { children: React.ReactNode }) {
      return <th className="px-3 py-2 text-left font-semibold border border-[var(--border)]">{children}</th>;
    },
    td({ children }: { children: React.ReactNode }) {
      return <td className="px-3 py-2 border border-[var(--border)]">{children}</td>;
    },

    // Links
    a({ href, children, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { children?: React.ReactNode }) {
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-500 hover:text-blue-400 underline underline-offset-2"
          {...rest}
        >
          {children}
        </a>
      );
    },

    // Horizontal rule
    hr() {
      return <hr className="my-4 border-[var(--border)]" />;
    },

    // Strong / Em
    strong({ children }: { children: React.ReactNode }) {
      return <strong className="font-semibold">{children}</strong>;
    },
  }), []);

  return (
    <div
      className={`prose prose-sm max-w-none text-[var(--foreground)] ${className}`}
      dir="auto"
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={components}
      >
        {sanitizedContent}
      </ReactMarkdown>
    </div>
  );
}
