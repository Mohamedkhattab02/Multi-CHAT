// Approximate token estimation (no tiktoken dependency)
// GPT-4 style: ~4 chars per token on average

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateMessagesTokens(
  messages: Array<{ role: string; content: string }>
): number {
  return messages.reduce((total, msg) => {
    return total + estimateTokens(msg.content) + 4; // 4 tokens overhead per message
  }, 3); // base overhead
}

export function truncateToTokenLimit(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '...';
}
