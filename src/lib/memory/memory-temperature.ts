// ============================================================
// Memory Temperature — V4
// Assigns HOT/WARM/COLD temperature to search results
// Determines injection priority in the context assembler
// ============================================================

import type { ClassificationResult } from '@/lib/ai/classifier';

export type Temperature = 'hot' | 'warm' | 'cold';

interface SearchResultForTemp {
  source_type: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
  score: number;
}

export function computeMemoryTemperature(
  result: SearchResultForTemp,
  classification: ClassificationResult,
  currentConversationId: string
): Temperature {
  const meta = result.metadata ?? {};
  const ageMs = Date.now() - new Date(result.created_at).getTime();
  const ageHours = ageMs / (1000 * 60 * 60);

  // HOT: anti-memories always, current conversation recent, document matches, high score
  if (result.source_type === 'anti_memory') return 'hot';
  if (meta.conversation_id === currentConversationId && ageHours < 2) return 'hot';
  if (result.source_type === 'document' && classification.referencesDocument) return 'hot';
  if (result.score > 0.85) return 'hot';

  // WARM: same conversation older, high-confidence memories, decent score
  if (meta.conversation_id === currentConversationId) return 'warm';
  if (result.source_type === 'fact' && (meta.confidence as number ?? 0) > 0.8) return 'warm';
  if (result.score > 0.6) return 'warm';

  // COLD: everything else that made it through reranking
  return 'cold';
}
