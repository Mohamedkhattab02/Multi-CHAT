// ============================================================
// Token Density Scoring — V4
// Scores content chunks by information density
// Code > structured data > prose > chitchat
// Used by context assembler to prioritize high-value content
// ============================================================

export function computeDensity(content: string): number {
  let score = 0.5;

  // Code blocks carry high information density
  if (/```[\s\S]*```/.test(content)) score += 0.3;

  // Headers indicate structured content
  if (/^#{1,6}\s/m.test(content)) score += 0.1;

  // Tables are information-dense
  if (/\|.*\|.*\|/.test(content)) score += 0.2;

  // Short messages are usually low-info
  if (content.length < 100) score -= 0.2;

  // Greetings/chitchat are lowest priority
  if (/^(hi|hello|thanks|ok|sure)/i.test(content)) score -= 0.3;

  return Math.max(0.1, Math.min(1.0, score));
}

/** Temperature weight multiplier for sorting */
export function temperatureWeight(temperature: 'hot' | 'warm' | 'cold'): number {
  switch (temperature) {
    case 'hot': return 3.0;
    case 'warm': return 1.5;
    case 'cold': return 1.0;
  }
}

/**
 * Sort and trim items to fit within a token budget.
 * Items are sorted by density × temperature_weight, dropping lowest first.
 */
export function trimByDensity<T extends { content: string; temperature: 'hot' | 'warm' | 'cold' }>(
  items: T[],
  maxTokens: number
): T[] {
  // Sort by priority (density × temperature)
  const scored = items.map(item => ({
    item,
    priority: computeDensity(item.content) * temperatureWeight(item.temperature),
  }));
  scored.sort((a, b) => b.priority - a.priority);

  const result: T[] = [];
  let totalTokens = 0;

  for (const { item } of scored) {
    const tokens = Math.ceil(item.content.length / 4);
    if (totalTokens + tokens > maxTokens && result.length > 0) break;
    result.push(item);
    totalTokens += tokens;
  }

  return result;
}
