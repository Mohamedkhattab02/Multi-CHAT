import * as Sentry from '@sentry/nextjs';

export async function generateEmbedding(text: string): Promise<number[]> {
  try {
    return await generateVoyageEmbedding(text);
  } catch (error) {
    Sentry.captureException(error, { tags: { service: 'voyage-ai', action: 'embedding' } });
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
      input: text.slice(0, 8000),
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
      input: text.slice(0, 8000),
      dimensions: 1024,
    }),
  });

  if (!response.ok) throw new Error(`OpenAI embeddings error: ${response.status}`);
  const data = await response.json();
  return data.data[0].embedding; // 1024 dimensions (truncated to match Voyage)
}