// ============================================================
// Voyage AI Reranker (rerank-2.5)
// Applied after hybrid search, before context injection
// Improves RAG accuracy by 30-40%
// Includes retry with exponential backoff for rate limits (429)
// ============================================================

import * as Sentry from '@sentry/nextjs';

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

interface RerankableDocument {
  content: string;
  [key: string]: unknown;
}

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  retries: number = MAX_RETRIES
): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const isRateLimit = error instanceof Error && error.message.includes('429');
      if (!isRateLimit || attempt === retries) throw error;
      const delay = BASE_DELAY_MS * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error('Unreachable');
}

export async function rerankResults<T extends RerankableDocument>(
  query: string,
  documents: T[],
  topK: number = 5
): Promise<T[]> {
  if (documents.length <= topK) return documents;

  try {
    return await retryWithBackoff(async () => {
      const response = await fetch('https://api.voyageai.com/v1/rerank', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.VOYAGE_AI_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'rerank-2.5',
          query,
          documents: documents.map((d) => d.content),
          top_k: topK,
        }),
      });

      if (!response.ok) throw new Error(`Voyage Rerank error: ${response.status}`);
      const data = await response.json();

      return data.data.map((r: { index: number }) => documents[r.index]);
    });
  } catch (error) {
    Sentry.captureException(error, {
      tags: { service: 'voyage-ai', action: 'rerank' },
    });
    console.warn('[Reranker] Failed, returning original order:', error);
    return documents.slice(0, topK);
  }
}
