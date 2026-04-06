export function estimateInformationDensity(text: string): number {
  let density = 0.3; // Base

  // Code blocks = very dense
  const codeBlocks = (text.match(/```[\s\S]*?```/g) || []).length;
  density += codeBlocks * 0.2;

  // Numbers and specific data = dense
  const numbers = (text.match(/\b\d+\.?\d*\b/g) || []).length;
  density += Math.min(numbers * 0.02, 0.15);

  // Identifiers = dense
  const identifiers = (text.match(/\b[a-z_][a-z0-9_]{2,}\b/g) || []).length;
  density += Math.min(identifiers * 0.005, 0.1);

  // Plain text without code = less dense
  const words = text.split(/\s+/).length;
  if (words > 0 && codeBlocks === 0) {
    density -= 0.1;
  }

  return Math.max(0.1, Math.min(density, 1.0));
}

export function estimateTokens(text: string): number {
  // ~4 chars per token for English, ~2.5 for Hebrew/Arabic. We average ~3.5
  return Math.ceil(text.length / 3.5);
}