import { createClient } from '@supabase/supabase-js';
import { generateEmbedding } from '@/lib/ai/embeddings';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export interface TemperaturedResult {
  id: string;
  content: string;
  source_type: string;
  source_id: string | null;
  metadata: Record<string, any>;
  created_at: string;
  score: number;
  temperature: 'hot' | 'warm' | 'cold';
}

interface RAGResult {
  context: string;
  preEmbeddedId?: string;
  temperaturedResults: TemperaturedResult[];
}

// --- Adaptive Weights ---
function computeAdaptiveWeights(query: string, intent: string): {
  full_text_weight: number;
  semantic_weight: number;
  fuzzy_weight: number;
} {
  let ft = 1.0, sem = 1.5, fuzz = 0.5;
  const isNonEnglish = /[\u0590-\u05FF\u0600-\u06FF]/.test(query);
  
  if (isNonEnglish) { sem = 2.5; fuzz = 0.1; }
  if (/\b([a-z_][a-z0-9_]*\s*\(|import\s+|from\s+[a-z])/i.test(query) || intent === 'code') {
    fuzz = 1.2; ft = 1.5;
  }
  if (/\b(מה זה|what is|הסבר|explain|למה|why|how does)\b/i.test(query)) {
    sem = 2.0; fuzz = 0.2;
  }
  if (query.split(' ').length <= 3) { sem = 2.5; fuzz = 0.3; ft = 0.5; }
  
  return { full_text_weight: ft, semantic_weight: sem, fuzzy_weight: fuzz };
}

// --- Memory Temperature ---
function assignTemperatures(
  results: any[],
  currentConversationId: string
): TemperaturedResult[] {
  const now = Date.now();
  return results.map(r => {
    const ageHours = (now - new Date(r.created_at).getTime()) / 3_600_000;
    const isCurrent = r.metadata?.conversation_id === currentConversationId;
    const importance = r.metadata?.importance || 0.5;
    let temp: 'hot' | 'warm' | 'cold' = 'cold';

    if ((r.score > 0.15 && (ageHours < 1 || isCurrent)) || importance > 0.8) temp = 'hot';
    else if (r.score > 0.08 || ageHours < 24) temp = 'warm';

    return { ...r, temperature: temp };
  });
}

// --- Pre-embedding ---
async function preEmbedCurrentMessage(
  userId: string,
  message: string,
  conversationId: string
): Promise<{ embedding: number[]; embeddedId?: string }> {
  const embedding = await generateEmbedding(message);
  const { data } = await supabase.from('embeddings').insert({
    user_id: userId,
    source_type: 'message',
    content: message,
    embedding,
    metadata: {
      conversation_id: conversationId,
      is_current_message: true,
      timestamp: new Date().toISOString(),
      importance: 0.5, // updated later in post-processing
    },
  }).select('id').single();

  return { embedding, embeddedId: data?.id };
}

// --- Main Pipeline ---
export async function retrieveMemories(
  userId: string,
  message: string,
  conversationId: string,
  classification: { intent: string; complexity: string; language: string },
  topK: number = 8
): Promise<RAGResult> {
  // 1. Pre-embed current message
  const { embedding, embeddedId } = await preEmbedCurrentMessage(userId, message, conversationId);

  // 2. Get adaptive weights
  const weights = computeAdaptiveWeights(message, classification.intent);

  // 3. Fingerprint scoped search (uses 256-dim to find top 3 similar convos)
  const embedding256 = embedding.slice(0, 256);
  const { data: similarConvos } = await supabase.rpc('search_similar_conversations', {
    query_embedding_256: embedding256,
    target_user_id: userId,
    match_count: 3,
  });

  const convoIds = [
    conversationId, // always include current conversation
    ...(similarConvos || [])
      .filter((c: any) => c.id !== conversationId)
      .map((c: any) => c.id),
  ];

  // 4. Execute Scoped Search (always includes current conversation + similar ones)
  const { data: searchData } = await supabase.rpc('hybrid_search_scoped', {
    query_text: message,
    query_embedding: embedding,
    target_user_id: userId,
    conversation_ids: convoIds,
    match_count: topK * 3,
    ...weights,
  });
  const results: any[] = searchData || [];

  // 5. Assign temperatures
  let temperatured = assignTemperatures(results, conversationId);

  // 6. Rerank
  temperatured = await rerankWithVoyage(message, temperatured, topK);

  // 7. Format Context String
  const context = temperatured.map(r => {
    const icon = r.temperature === 'hot' ? '●' : r.temperature === 'warm' ? '◑' : '○';
    const src = r.source_type === 'document' ? `[Doc: ${r.metadata?.filename}]` : 
                r.source_type === 'fact' ? `[Fact]` : `[Msg]`;
    return `${icon} ${src} ${r.content}`;
  }).join('\n\n');

  return { context, preEmbeddedId: embeddedId, temperaturedResults: temperatured };
}

async function rerankWithVoyage(
  query: string,
  docs: TemperaturedResult[],
  topK: number
): Promise<TemperaturedResult[]> {
  if (docs.length <= topK) return docs;
  try {
    const res = await fetch('https://api.voyageai.com/v1/rerank', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.VOYAGE_AI_API_KEY}` },
      body: JSON.stringify({ model: 'rerank-3', query, documents: docs.map(d => d.content), top_k: topK }),
    });
    const data = await res.json();
    return data.data.map((r: any) => docs[r.index]);
  } catch {
    return docs.sort((a, b) => b.score - a.score).slice(0, topK);
  }
}