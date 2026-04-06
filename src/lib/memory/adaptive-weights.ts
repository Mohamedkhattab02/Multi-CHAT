export interface SearchWeights {
  full_text_weight: number;
  semantic_weight: number;
  fuzzy_weight: number;
}

export function computeAdaptiveWeights(
  query: string,
  intent: string
): SearchWeights {
  let ft = 1.0, sem = 1.5, fuzz = 0.5;

  // Hebrew/Arabic -> boost semantic, kill fuzzy (pg_trgm doesn't work cross-lingual)
  if (/[\u0590-\u05FF\u0600-\u06FF]/.test(query)) {
    sem = 2.5;
    fuzz = 0.1;
  }

  // Code identifiers -> boost fuzzy
  if (
    /\b([a-z_][a-z0-9_]*\s*\(|import\s+|from\s+[a-z])/i.test(query) ||
    intent === 'code'
  ) {
    fuzz = 1.2;
    ft = 1.5;
  }

  // Conceptual questions -> semantic dominant
  if (/\b(מה זה|what is|הסבר|explain|למה|why|how does|איך)\b/i.test(query)) {
    sem = 2.0;
    fuzz = 0.2;
  }

  // Short queries -> semantic only
  if (query.split(' ').length <= 3) {
    sem = 2.5;
    fuzz = 0.3;
    ft = 0.5;
  }

  // Quoted terms -> fulltext boost
  if (/"[^"]+"|'[^']+'/.test(query)) {
    ft = 2.0;
  }

  return { full_text_weight: ft, semantic_weight: sem, fuzzy_weight: fuzz };
}