import * as Sentry from '@sentry/nextjs';

export async function rerankResults(
  query: string,
  documents: Array<{ content: string; [key: string]: any }>,
  topK: number = 5
): Promise<Array<{ content: string; [key: string]: any }>> {
  if (documents.length <= topK) return documents;

  try {
    const response = await fetch('https://api.voyageai.com/v1/rerank', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.VOYAGE_AI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'rerank-3',
        query,
        documents: documents.map(d => d.content),
        top_k: topK,
      }),
    });

    if (!response.ok) throw new Error(`Voyage Rerank error: ${response.status}`);
    const data = await response.json();
    return data.data.map((r: any) => documents[r.index]);
  } catch (error) {
    Sentry.captureException(error, { tags: { service: 'voyage-ai', action: 'rerank' } });
    console.warn('[Reranker] Failed, returning original order:', error);
    return documents.slice(0, topK);
  }
}