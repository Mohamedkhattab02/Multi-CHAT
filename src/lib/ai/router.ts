import type { ClassificationResult } from './classifier';
import type { ModelId } from '@/lib/utils/constants';

// ============================================================
// Model router — maps classification + user selection to final model
//
// Routing logic:
// 1. If routeOverride is set → use override model
// 2. If user selected GPT 5.1 → route to gpt-5-mini for low complexity, gpt-5.1 for medium/high
// 3. If user selected Gemini 3.1 Pro → keep Pro for medium/high, downgrade to Flash for low + no RAG
// 4. GLM 5 — always GLM 5, no downgrade
// ============================================================

export interface RoutingDecision {
  finalModel: ModelId;
  wasOverridden: boolean;
  overrideReason?: string;
}

export function resolveModel(
  userSelectedModel: ModelId,
  classification: ClassificationResult
): RoutingDecision {
  // Special routing overrides take absolute priority
  if (classification.routeOverride !== 'none') {
    return {
      finalModel: classification.routeOverride as ModelId,
      wasOverridden: true,
      overrideReason: classification.needsInternet
        ? 'internet_search'
        : classification.needsImageGeneration
        ? 'image_generation'
        : classification.hasImageInput
        ? 'image_analysis'
        : 'routing_override',
    };
  }

  // GPT family: complexity-based routing
  if (userSelectedModel === 'gpt-5.1' || userSelectedModel === 'gpt-5-mini') {
    if (classification.complexity === 'low' && !classification.needsRAG) {
      return { finalModel: 'gpt-5-mini', wasOverridden: false };
    }
    return { finalModel: 'gpt-5.1', wasOverridden: false };
  }

  // Gemini family: keep Pro for non-trivial queries
  if (userSelectedModel === 'gemini-3.1-pro') {
    if (classification.complexity === 'low' && !classification.needsRAG) {
      return { finalModel: 'gemini-3-flash', wasOverridden: false };
    }
    return { finalModel: 'gemini-3.1-pro', wasOverridden: false };
  }

  // GLM 5: no sub-routing
  if (userSelectedModel === 'glm-5') {
    return { finalModel: 'glm-5', wasOverridden: false };
  }

  // Fallback: use whatever the user selected
  return { finalModel: userSelectedModel, wasOverridden: false };
}

export function getOverrideBadgeLabel(reason?: string): string | null {
  if (!reason) return null;
  switch (reason) {
    case 'internet_search': return '🔍 via Gemini Flash';
    case 'image_generation': return '🎨 via Gemini Image';
    case 'image_analysis': return '👁 via Gemini Flash';
    default: return null;
  }
}
