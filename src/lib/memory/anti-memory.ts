import { generateEmbedding } from '@/lib/ai/embeddings';
import { createClient } from '@supabase/supabase-js';

const REJECTION_PATTERNS = [
  /\b(לא עבד|didn't work|doesn't work|שגיאה|error|fail|כשל)\b/i,
  /\b(תשכח|forget|ignore|don't use|אל תשתמש|בטל|cancel)\b/i,
  /\b(לא נכון|wrong|incorrect|בלתי נכון|not right|ממש לא)\b/i,
  /\b(שיניתי דעה|changed my mind|החלטתי אחרת|actually I want)\b/i,
];

export async function detectAntiMemory(
  userId: string,
  conversationId: string,
  userMessage: string,
  assistantMessage: string
): Promise<void> {
  if (!REJECTION_PATTERNS.some(p => p.test(userMessage))) return;

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  try {
    const searchContent = `${userMessage.slice(0, 300)} ${assistantMessage.slice(0, 300)}`;
    const embedding = await generateEmbedding(searchContent);

    const { data: related } = await supabase.rpc('hybrid_search', {
      query_text: userMessage,
      query_embedding: embedding,
      target_user_id: userId,
      match_count: 3,
    });

    if (!related || related.length === 0) return;

    const factIds = related
      .filter((r: any) => r.source_type === 'fact' || r.source_type === 'preference')
      .map((r: any) => r.source_id)
      .filter(Boolean);

    if (factIds.length === 0) return;

    const { data: antiMemory } = await supabase.from('memories').insert({
      user_id: userId,
      type: 'rejection',
      content: `Rejected approach: "${userMessage.slice(0, 200)}". Was related to: "${related[0].content.slice(0, 150)}"`,
      confidence: 0.95,
      source_conversation_id: conversationId,
      is_active: true,
    }).select('id').single();

    if (antiMemory) {
      await supabase
        .from('memories')
        .update({ is_active: false, invalidated_by: antiMemory.id })
        .in('id', factIds);
    }
  } catch (error) {
    console.error('[Anti-Memory] Error:', error);
  }
}