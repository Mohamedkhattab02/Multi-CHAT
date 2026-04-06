// ============================================================
// Adaptive Search Weights — V4
// Adjusts hybrid search weights based on query characteristics
// Code queries → boost fuzzy, Hebrew/Arabic → semantic only
// ============================================================

export interface SearchWeights {
  fulltext: number;
  semantic: number;
  fuzzy: number;
}

export function computeAdaptiveWeights(params: {
  intent: string;
  language: string;
  hasCodeMarkers: boolean;
}): SearchWeights {
  // Cross-lingual: semantic only (fuzzy doesn't work across languages)
  if (params.language === 'he' || params.language === 'ar' || params.language === 'mixed') {
    return { fulltext: 0.3, semantic: 2.0, fuzzy: 0.0 };
  }

  // Code with exact symbols: boost fuzzy for function/variable name matches
  if (params.intent === 'code' && params.hasCodeMarkers) {
    return { fulltext: 1.2, semantic: 1.0, fuzzy: 1.5 };
  }

  // Conceptual/analytical: semantic dominates
  if (params.intent === 'analysis' || params.intent === 'question') {
    return { fulltext: 0.8, semantic: 2.0, fuzzy: 0.3 };
  }

  // Creative: balanced
  if (params.intent === 'creative') {
    return { fulltext: 1.0, semantic: 1.5, fuzzy: 0.5 };
  }

  // Default (V1 weights)
  return { fulltext: 1.0, semantic: 1.5, fuzzy: 0.5 };
}
