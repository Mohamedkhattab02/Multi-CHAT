// ============================================================
// Embedding generation with automatic failover
// Primary: Voyage AI voyage-4-large (1024 dims)
// Fallback: OpenAI text-embedding-3-large (1024 dims truncated)
// Sequential queue to prevent concurrent 429 rate limit errors
// V4: adds batch support for document processing
// ============================================================

import * as Sentry from '@sentry/nextjs';

const MAX_INPUT_LENGTH = 8000;
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
// Voyage AI free tier: ~3 req/sec. Add 250ms gap between requests.
const INTER_REQUEST_DELAY_MS = 250;
// Voyage AI batch limit
const VOYAGE_BATCH_MAX = 128;

// Sequential queue: ensures only one Voyage AI request at a time
let voyageQueue: Promise<unknown> = Promise.resolve();

function enqueueVoyageRequest<T>(fn: () => Promise<T>): Promise<T> {
  const result = voyageQueue.then(async () => {
    const r = await fn();
    // Delay AFTER each request to stay under rate limit
    await new Promise(resolve => setTimeout(resolve, INTER_REQUEST_DELAY_MS));
    return r;
  }, fn);
  voyageQueue = result.catch(() => {});
  return result;
}

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  retries: number = MAX_RETRIES
): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const status = error instanceof Error ? extractStatus(error.message) : 0;
      const isRetryable = status === 429 || status === 500 || status === 502 || status === 503;
      if (!isRetryable || attempt === retries) throw error;
      const delay = BASE_DELAY_MS * Math.pow(2, attempt);
      console.warn(`[Embeddings] ${status === 429 ? 'Rate limited' : 'Server error'}, retrying in ${delay}ms (attempt ${attempt + 1}/${retries})`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error('Unreachable');
}

/** Extract HTTP status from error message like "Voyage AI error: 429" */
function extractStatus(message: string): number {
  const match = message.match(/\b(\d{3})\b/);
  return match ? parseInt(match[1], 10) : 0;
}

// ═══════════════════════════════════════════════════════════
// Single embedding (for RAG queries, query expansion, etc.)
// ═══════════════════════════════════════════════════════════

export async function generateEmbedding(text: string): Promise<number[]> {
  try {
    return await enqueueVoyageRequest(() =>
      retryWithBackoff(() => generateVoyageEmbedding(text))
    );
  } catch (voyageError) {
    Sentry.captureException(voyageError, {
      tags: { service: 'voyage-ai', action: 'embedding_single' },
    });
    console.warn('[Embeddings] Voyage AI failed for single, falling back to OpenAI:', voyageError);

    try {
      return await generateOpenAIEmbedding(text);
    } catch (openaiError) {
      Sentry.captureException(openaiError, {
        tags: { service: 'openai', action: 'embedding_single_fallback' },
      });
      console.error('[Embeddings] OpenAI fallback also failed:', openaiError);
      // Return zero vector as absolute last resort — caller should handle this
      return new Array(1024).fill(0);
    }
  }
}

// ═══════════════════════════════════════════════════════════
// Batch embedding (for document processing — one API call)
// Voyage AI supports up to 128 texts in a single request.
// This turns 25 sequential calls into 1 call = no rate limit.
// ═══════════════════════════════════════════════════════════

export async function generateEmbeddingBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (texts.length === 1) {
    const emb = await generateEmbedding(texts[0]);
    return [emb];
  }

  // Try Voyage AI batch first
  try {
    return await enqueueVoyageRequest(() =>
      retryWithBackoff(() => generateVoyageEmbeddingBatch(texts))
    );
  } catch (voyageError) {
    Sentry.captureException(voyageError, {
      tags: { service: 'voyage-ai', action: 'embedding_batch' },
      extra: { batch_size: texts.length },
    });
    console.warn(`[Embeddings] Voyage AI batch failed (${texts.length} texts), falling back to OpenAI sequential:`, voyageError);

    // Fallback: OpenAI sequential with delay between calls
    return await generateOpenAIEmbeddingBatch(texts);
  }
}

// ═══════════════════════════════════════════════════════════
// Voyage AI implementations
// ═══════════════════════════════════════════════════════════

async function generateVoyageEmbedding(text: string): Promise<number[]> {
  const response = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.VOYAGE_AI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'voyage-4-large',
      input: text.slice(0, MAX_INPUT_LENGTH),
      input_type: 'document',
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Voyage AI error: ${response.status}${body ? ` — ${body.slice(0, 200)}` : ''}`);
  }
  const data = await response.json();
  return data.data[0].embedding;
}

async function generateVoyageEmbeddingBatch(texts: string[]): Promise<number[][]> {
  // Voyage supports max 128 inputs per batch request
  const batches: string[][] = [];
  for (let i = 0; i < texts.length; i += VOYAGE_BATCH_MAX) {
    batches.push(texts.slice(i, i + VOYAGE_BATCH_MAX));
  }

  const allEmbeddings: number[][] = [];

  for (const batch of batches) {
    const response = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.VOYAGE_AI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'voyage-4-large',
        input: batch.map(t => t.slice(0, MAX_INPUT_LENGTH)),
        input_type: 'document',
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Voyage AI batch error: ${response.status}${body ? ` — ${body.slice(0, 200)}` : ''}`);
    }

    const data = await response.json();
    // Voyage returns data as array in same order as input
    for (const item of data.data) {
      allEmbeddings.push(item.embedding);
    }
  }

  return allEmbeddings;
}

// ═══════════════════════════════════════════════════════════
// OpenAI implementations (fallback)
// ═══════════════════════════════════════════════════════════

async function generateOpenAIEmbedding(text: string): Promise<number[]> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OpenAI API key not configured (OPENAI_API_KEY env var missing)');
  }

  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'text-embedding-3-large',
      input: text.slice(0, MAX_INPUT_LENGTH),
      dimensions: 1024,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`OpenAI embeddings error: ${response.status}${body ? ` — ${body.slice(0, 200)}` : ''}`);
  }
  const data = await response.json();
  return data.data[0].embedding;
}

/**
 * OpenAI batch fallback: sends texts in groups of 100 (OpenAI's batch limit)
 * with 200ms delay between batches to avoid rate limits.
 * Returns zero vectors for any text that fails individually.
 */
async function generateOpenAIEmbeddingBatch(texts: string[]): Promise<number[][]> {
  if (!process.env.OPENAI_API_KEY) {
    console.error('[Embeddings] OpenAI API key not configured, returning zero vectors for batch');
    return texts.map(() => new Array(1024).fill(0));
  }

  const OPENAI_BATCH_MAX = 100;
  const results: number[][] = [];
  const zeroVector = new Array(1024).fill(0);

  for (let i = 0; i < texts.length; i += OPENAI_BATCH_MAX) {
    const batch = texts.slice(i, i + OPENAI_BATCH_MAX);

    try {
      const response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'text-embedding-3-large',
          input: batch.map(t => t.slice(0, MAX_INPUT_LENGTH)),
          dimensions: 1024,
        }),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        console.error(`[Embeddings] OpenAI batch failed: ${response.status} — ${body.slice(0, 200)}`);
        // Fill with zero vectors for this batch
        results.push(...batch.map(() => zeroVector));
        continue;
      }

      const data = await response.json();
      // Sort by index to maintain order (OpenAI doesn't guarantee order)
      const sorted = data.data.sort((a: { index: number }, b: { index: number }) => a.index - b.index);
      for (const item of sorted) {
        results.push(item.embedding);
      }
    } catch (err) {
      console.error('[Embeddings] OpenAI batch exception:', err);
      results.push(...batch.map(() => zeroVector));
    }

    // Delay between batches to avoid OpenAI rate limits
    if (i + OPENAI_BATCH_MAX < texts.length) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  return results;
}