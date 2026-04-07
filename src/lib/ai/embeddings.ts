// ============================================================
// Embedding generation with automatic failover
// Primary: Voyage AI voyage-4-large (1024 dims)
// Fallback: OpenAI text-embedding-3-large (1024 dims truncated)
// Sequential queue to prevent concurrent 429 rate limit errors
// ============================================================

import * as Sentry from '@sentry/nextjs';

const MAX_INPUT_LENGTH = 8000;
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

// Sequential queue: ensures only one Voyage AI request at a time
let voyageQueue: Promise<unknown> = Promise.resolve();

function enqueueVoyageRequest<T>(fn: () => Promise<T>): Promise<T> {
  const result = voyageQueue.then(fn, fn);
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
      const isRateLimit = error instanceof Error && error.message.includes('429');
      if (!isRateLimit || attempt === retries) throw error;
      const delay = BASE_DELAY_MS * Math.pow(2, attempt);
      console.warn(`[Embeddings] Rate limited, retrying in ${delay}ms (attempt ${attempt + 1}/${retries})`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error('Unreachable');
}

export async function generateEmbedding(text: string): Promise<number[]> {
  try {
    return await enqueueVoyageRequest(() =>
      retryWithBackoff(() => generateVoyageEmbedding(text))
    );
  } catch (error) {
    Sentry.captureException(error, {
      tags: { service: 'voyage-ai', action: 'embedding' },
    });
    console.warn('[Embeddings] Voyage AI failed, falling back to OpenAI:', error);
    return await generateOpenAIEmbedding(text);
  }
}

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

  if (!response.ok) throw new Error(`Voyage AI error: ${response.status}`);
  const data = await response.json();
  return data.data[0].embedding; // 1024 dimensions
}

async function generateOpenAIEmbedding(text: string): Promise<number[]> {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'text-embedding-3-large',
      input: text.slice(0, MAX_INPUT_LENGTH),
      dimensions: 1024, // truncate to match Voyage AI
    }),
  });

  if (!response.ok) throw new Error(`OpenAI embeddings error: ${response.status}`);
  const data = await response.json();
  return data.data[0].embedding; // 1024 dimensions (truncated)
}
