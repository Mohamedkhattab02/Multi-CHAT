// ============================================================
// Context Assembler — Layer 3 of 7-layer memory system
// Builds the final messages array with strict token budgets
// ============================================================

import { TOKEN_BUDGETS, type ModelId } from '@/lib/utils/constants';
import { estimateTokens, estimateMessagesTokens } from '@/lib/utils/tokens';

interface AssembleParams {
  model: string;
  userProfile: {
    name?: string | null;
    language?: string;
    expertise?: string;
  } | null;
  ragContext: string;
  messages: Array<{ role: string; content: string }>;
  rollingSummary?: string | null;
  language: string;
}

interface AssembledContext {
  systemPrompt: string;
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
}

export function assembleContext(params: AssembleParams): AssembledContext {
  const budget = TOKEN_BUDGETS[params.model as ModelId] ?? TOKEN_BUDGETS['gemini-3.1-pro'];

  const systemPrompt = buildSystemPrompt(
    params.userProfile,
    params.ragContext,
    params.language,
    budget.system,
    budget.rag
  );

  const assembledMessages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [];

  // Inject rolling summary as pseudo-message for long conversations
  if (params.rollingSummary) {
    assembledMessages.push(
      { role: 'user', content: `[Previous conversation context]: ${params.rollingSummary}` },
      { role: 'assistant', content: 'I have the context from our earlier conversation. Let\'s continue.' }
    );
  }

  // Add recent messages (respecting token budget)
  const recentMessages = trimToTokenBudget(params.messages, budget.history);
  assembledMessages.push(...recentMessages);

  return { systemPrompt, messages: assembledMessages };
}

function buildSystemPrompt(
  userProfile: AssembleParams['userProfile'],
  ragContext: string,
  language: string,
  systemBudget: number,
  ragBudget: number
): string {
  const parts: string[] = [];

  // Core identity
  parts.push(
    'You are MultiChat AI, a helpful multi-model AI assistant.',
    'You provide accurate, clear, and well-structured responses.',
    'Use markdown formatting when appropriate (code blocks, lists, headers).',
    'For code: always specify the language in code blocks.',
    'Be concise but thorough.'
  );

  // Language instruction
  if (language && language !== 'auto') {
    const langNames: Record<string, string> = {
      he: 'Hebrew', en: 'English', ar: 'Arabic',
    };
    parts.push(`Respond in ${langNames[language] || language}.`);
  } else {
    parts.push('Respond in the same language as the user\'s message.');
  }

  // User personalization
  if (userProfile) {
    if (userProfile.name) parts.push(`The user's name is ${userProfile.name}.`);
    if (userProfile.expertise && userProfile.expertise !== 'general') {
      parts.push(`The user's expertise level: ${userProfile.expertise}.`);
    }
  }

  // RAG context
  if (ragContext) {
    const trimmedRAG = ragContext.slice(0, ragBudget * 4); // approx chars
    parts.push(
      '\n--- RELEVANT MEMORIES ---',
      trimmedRAG,
      '--- END MEMORIES ---',
      'Use these memories to personalize your response when relevant, but do not mention that you have access to memories.'
    );
  }

  const full = parts.join('\n');
  // Trim to system budget
  return full.slice(0, systemBudget * 4);
}

function trimToTokenBudget(
  messages: Array<{ role: string; content: string }>,
  maxTokens: number
): Array<{ role: 'user' | 'assistant' | 'system'; content: string }> {
  // Always include at least the last message
  if (messages.length === 0) return [];

  const result: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [];
  let totalTokens = 0;

  // Work backwards from most recent
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const tokens = estimateTokens(msg.content) + 4;

    if (totalTokens + tokens > maxTokens && result.length > 0) break;

    result.unshift({
      role: msg.role as 'user' | 'assistant' | 'system',
      content: msg.content,
    });
    totalTokens += tokens;
  }

  return result;
}
