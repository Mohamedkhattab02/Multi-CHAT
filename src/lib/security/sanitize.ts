// DOMPurify sanitization wrapper
// Only runs on the client (DOMPurify requires DOM)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let purifyInstance: any = null;
let loadingPromise: Promise<void> | null = null;

const SANITIZE_CONFIG = {
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
};

async function loadDOMPurify(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (purifyInstance) return;
  if (!loadingPromise) {
    loadingPromise = import('dompurify').then((mod) => {
      purifyInstance = mod.default;
    });
  }
  return loadingPromise;
}

// Eagerly preload DOMPurify on client
if (typeof window !== 'undefined') {
  loadDOMPurify();
}

export async function sanitizeHtml(dirty: string): Promise<string> {
  await loadDOMPurify();
  if (!purifyInstance) return dirty; // SSR fallback
  return purifyInstance.sanitize(dirty, SANITIZE_CONFIG) as string;
}

export function sanitizeHtmlSync(dirty: string): string {
  if (typeof window === 'undefined') return dirty;
  if (!purifyInstance) {
    // Fallback: escape HTML if DOMPurify hasn't loaded yet
    return sanitizeText(dirty);
  }
  return purifyInstance.sanitize(dirty, SANITIZE_CONFIG) as string;
}

export function sanitizeText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}
