// ============================================================
// Query Expander — V4
// HyDE (Hypothetical Document Embedding) + multi-query expansion
// Generates multiple search queries from a single user message
// for broader RAG coverage
// ============================================================

import * as Sentry from '@sentry/nextjs';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

async function callGeminiFlashJSON(prompt: string): Promise<string[]> {
  const response = await fetch(GEMINI_API_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': process.env.GOOGLE_AI_API_KEY!,
    },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: 4096,
        temperature: 0.3,
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!response.ok) throw new Error(`Gemini Flash error: ${response.status}`);
  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Expand a single user message into multiple search queries.
 * Returns: [original, hypothetical_answer, rephrased_1, rephrased_2]
 */
export async function expandQuery(params: {
  original: string;
  context: string;
  language: string;
}): Promise<string[]> {
  const { original, context, language } = params;
  const queries = [original];

  // Skip expansion for very short messages
  if (original.trim().length < 20) return queries;

  try {
    const langHint = language === 'he' ? 'Respond in Hebrew.' :
      language === 'ar' ? 'Respond in Arabic.' : '';

    const expanded = await callGeminiFlashJSON(`
You are a search query expander. Given a user message and conversation context, generate exactly 3 alternative search queries that would help find relevant information in a RAG database.

${langHint}

Return a JSON array of 3 strings. Each should be a different angle on the same topic:
1. A hypothetical answer snippet (HyDE) — what the answer might contain
2. A rephrased version of the query using different keywords
3. A broader/narrower version depending on specificity

Conversation context: "${context.slice(0, 300)}"
User message: "${original.slice(0, 500)}"

Return ONLY a JSON array of 3 strings.`);

    if (expanded.length > 0) {
      queries.push(...expanded.slice(0, 3).map(q => String(q).slice(0, 500)));
    }
  } catch (error) {
    Sentry.captureException(error, {
      tags: { action: 'query_expansion' },
    });
    console.warn('[QueryExpander] Failed, using original only:', error);
  }

  return queries;
}
