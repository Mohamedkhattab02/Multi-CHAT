import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { generateEmbedding } from '@/lib/ai/embeddings';

export async function POST(req: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { query, conversationId } = await req.json();
  if (!query || query.length < 10) {
    return NextResponse.json({ results: [] });
  }

  try {
    const embedding = await generateEmbedding(query);

    const { data } = await supabase.rpc('hybrid_search', {
      query_text: query,
      query_embedding: embedding,
      target_user_id: user.id,
      match_count: 3,
      full_text_weight: 0,
      semantic_weight: 1.0,
      fuzzy_weight: 0,
    });

    return NextResponse.json({ results: data || [] });
  } catch (error) {
    console.error('[Preemptive Search] Error:', error);
    return NextResponse.json({ results: [] });
  }
}
