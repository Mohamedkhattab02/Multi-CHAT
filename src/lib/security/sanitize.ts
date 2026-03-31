// DOMPurify sanitization wrapper
// Only runs on the client (DOMPurify requires DOM)

let DOMPurifyInstance: typeof import('dompurify') | null = null;

async function getDOMPurify() {
  if (typeof window === 'undefined') return null;
  if (!DOMPurifyInstance) {
    const { default: DOMPurify } = await import('dompurify');
    DOMPurifyInstance = DOMPurify;
  }
  return DOMPurifyInstance;
}

export async function sanitizeHtml(dirty: string): Promise<string> {
  const purify = await getDOMPurify();
  if (!purify) return dirty; // SSR: return as-is (markdown renderer handles it)
  return purify.sanitize(dirty, {
    ALLOWED_TAGS: [
      'p', 'br', 'strong', 'em', 'u', 's', 'code', 'pre',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'ul', 'ol', 'li', 'blockquote', 'hr',
      'a', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'span', 'div', 'sup', 'sub',
    ],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'class', 'id', 'target', 'rel'],
    FORBID_ATTR: ['style', 'onclick', 'onerror', 'onload'],
    ALLOW_DATA_ATTR: false,
  });
}

// Synchronous version for when we can't use async (requires DOMPurify to be preloaded)
export function sanitizeHtmlSync(dirty: string): string {
  if (typeof window === 'undefined') return dirty;
  if (!DOMPurifyInstance) return dirty;
  return (DOMPurifyInstance as any).sanitize(dirty, {
    ALLOWED_TAGS: [
      'p', 'br', 'strong', 'em', 'u', 's', 'code', 'pre',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'ul', 'ol', 'li', 'blockquote', 'hr',
      'a', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'span', 'div', 'sup', 'sub',
    ],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'class', 'id', 'target', 'rel'],
    FORBID_ATTR: ['style', 'onclick', 'onerror', 'onload'],
    ALLOW_DATA_ATTR: false,
  });
}

export function sanitizeText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}
