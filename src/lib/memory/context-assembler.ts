// ============================================================
// Context Assembler — V4
// Builds the final messages array with two halves:
// 1. STABLE PREFIX (Gemini-cacheable): system + profile + WM + summary
// 2. VARIABLE SUFFIX: HOT/WARM/COLD memories + recent msgs + current
// Density-aware budgeting: code > prose > chitchat
// ============================================================

import { TOKEN_BUDGETS, type ModelId } from '@/lib/utils/constants';
import { estimateTokens } from '@/lib/utils/tokens';
import { computeDensity, temperatureWeight } from '@/lib/memory/token-density';
import type { RetrievedResult, RetrievedContext } from '@/lib/memory/rag-pipeline';
import type { WorkingMemory } from '@/lib/memory/working-memory';
import type { StructuredSummary } from '@/lib/memory/rolling-summary';
import type { ClassificationResult } from '@/lib/ai/classifier';

// V4 token budgets per model
const V4_BUDGETS: Record<string, {
  system: number;
  stable: number;
  hot: number;
  warm: number;
  cold: number;
  recent: number;
  output: number;
}> = {
  'gpt-5.1':        { system: 2000, stable: 3000, hot: 4000, warm: 2000, cold: 1000, recent: 6000, output: 4096 },
  'gpt-5-mini':     { system: 1500, stable: 2000, hot: 2500, warm: 1500, cold: 500, recent: 4000, output: 4096 },
  'gemini-3.1-pro': { system: 2000, stable: 4000, hot: 6000, warm: 3000, cold: 2000, recent: 16000, output: 8192 },
  'gemini-3-flash': { system: 1500, stable: 3000, hot: 4000, warm: 2000, cold: 1000, recent: 8000, output: 4096 },
  'glm-4.7':        { system: 2000, stable: 3000, hot: 4000, warm: 2000, cold: 1000, recent: 6000, output: 4096 },
  'glm-4.6':        { system: 1500, stable: 2000, hot: 2500, warm: 1500, cold: 500, recent: 4000, output: 4096 },
  'gemini-3.1-flash-image': { system: 1000, stable: 1500, hot: 2000, warm: 1000, cold: 500, recent: 4000, output: 2000 },
};

interface AssembleParams {
  model: string;
  userProfile: {
    name?: string | null;
    language?: string;
    expertise?: string;
    preferences?: Record<string, unknown>;
  } | null;
  ragContext: RetrievedContext | null;
  messages: Array<{ role: string; content: string }>;
  rollingSummary?: string | null;
  structuredSummary?: StructuredSummary | null;
  workingMemory?: WorkingMemory | null;
  documentRegistry?: Array<{ filename: string; summary: string }>;
  classification: ClassificationResult;
  language: string;
}

interface AssembledContext {
  systemPrompt: string;
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
}

export function assembleContext(params: AssembleParams): AssembledContext {
  const budget = V4_BUDGETS[params.model] ?? V4_BUDGETS['gemini-3.1-pro'];

  // ═══ STABLE PREFIX (cacheable by Gemini) ���══
  const systemPrompt = buildStablePrefix(params, budget);

  // ═══ VARIABLE SUFFIX ═══
  const assembledMessages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [];

  // Inject document chunks as their own section (highest priority)
  if (params.ragContext?.documentChunks?.length) {
    const docBlock = buildDocumentBlock(params.ragContext.documentChunks, budget);
    if (docBlock) {
      assembledMessages.push(
        { role: 'user', content: `[Document content from uploaded files]\n${docBlock}` },
        { role: 'assistant', content: 'I have the document content. I can answer questions about it.' }
      );
    }
  }

  // Inject RAG memories by temperature tier (non-document)
  if (params.ragContext) {
    const ragBlock = buildRAGBlock(params.ragContext, budget);
    if (ragBlock) {
      assembledMessages.push(
        { role: 'user', content: `[Retrieved context from memory]\n${ragBlock}` },
        { role: 'assistant', content: 'I have the retrieved context. Let\'s continue.' }
      );
    }
  }

  // Determine adaptive window size
  const windowSize = determineWindowSize(params.classification, params.ragContext);

  // Add recent messages (adaptive window)
  const recentMessages = trimToTokenBudget(
    params.messages.slice(-(windowSize + 1)), // +1 for current
    budget.recent
  );
  assembledMessages.push(...recentMessages);

  return { systemPrompt, messages: assembledMessages };
}

function buildStablePrefix(
  params: AssembleParams,
  budget: typeof V4_BUDGETS[string]
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
  if (params.language && params.language !== 'auto' && params.language !== 'en') {
    const langNames: Record<string, string> = {
      he: 'Hebrew', en: 'English', ar: 'Arabic', mixed: 'the same language as the user',
    };
    parts.push(`Respond in ${langNames[params.language] || params.language}.`);
  } else {
    parts.push('Respond in the same language as the user\'s message.');
  }

  // User profile
  if (params.userProfile) {
    const profile: string[] = [];
    if (params.userProfile.name) profile.push(`Name: ${params.userProfile.name}`);
    if (params.userProfile.language && params.userProfile.language !== 'auto') {
      profile.push(`Language: ${params.userProfile.language}`);
    }
    if (params.userProfile.expertise && params.userProfile.expertise !== 'general') {
      profile.push(`Expertise: ${params.userProfile.expertise}`);
    }
    if (profile.length > 0) {
      parts.push('\nUser Profile:\n' + profile.map(p => `- ${p}`).join('\n'));
    }
  }

  // Document registry
  if (params.documentRegistry && params.documentRegistry.length > 0) {
    const docs = params.documentRegistry
      .map(d => `- "${d.filename}": ${d.summary}`)
      .join('\n');
    parts.push(`\nDocuments in this conversation:\n${docs}`);
  }

  // Working memory (current task + phase)
  if (params.workingMemory && params.workingMemory.current_task) {
    const wm = params.workingMemory;
    const wmParts: string[] = [];
    wmParts.push(`Task: ${wm.current_task}`);
    if (wm.phase !== 'idle') wmParts.push(`Phase: ${wm.phase}`);
    if (wm.active_entities.length > 0) wmParts.push(`Active: ${wm.active_entities.join(', ')}`);
    if (wm.sub_tasks.length > 0) wmParts.push(`Sub-tasks: ${wm.sub_tasks.join(', ')}`);
    if (wm.last_decision) wmParts.push(`Last decision: ${wm.last_decision}`);
    parts.push('\nCurrent task (working memory):\n' + wmParts.map(p => `- ${p}`).join('\n'));
  }

  // Macro summary (conversation arc)
  if (params.structuredSummary?.narrative) {
    parts.push(`\nConversation so far:\n${params.structuredSummary.narrative}`);
    if (params.structuredSummary.decisions.length > 0) {
      parts.push(`Decisions: ${params.structuredSummary.decisions.slice(-5).join('; ')}`);
    }
    if (params.structuredSummary.open_threads.length > 0) {
      parts.push(`Open threads: ${params.structuredSummary.open_threads.join('; ')}`);
    }
  } else if (params.rollingSummary) {
    parts.push(`\nConversation so far:\n${params.rollingSummary}`);
  }

  const full = parts.join('\n');
  return full.slice(0, (budget.system + budget.stable) * 4);
}

/**
 * Build a dedicated document section.
 * Chunks are already sorted by file + chunk_index in reading order.
 * Uses the HOT budget (document content is highest priority when referenced).
 */
function buildDocumentBlock(
  documentChunks: RetrievedResult[],
  budget: typeof V4_BUDGETS[string]
): string | null {
  if (documentChunks.length === 0) return null;

  // Group chunks by file name
  const byFile = new Map<string, RetrievedResult[]>();
  for (const chunk of documentChunks) {
    const fileName = String(chunk.metadata?.file_name || 'document');
    if (!byFile.has(fileName)) byFile.set(fileName, []);
    byFile.get(fileName)!.push(chunk);
  }

  const sections: string[] = [];
  let totalTokens = 0;
  // Document chunks get the HOT budget — they're the most important when referenced
  const maxTokens = budget.hot;

  for (const [fileName, chunks] of byFile) {
    // Sort by chunk_index within each file
    chunks.sort((a, b) =>
      (Number(a.metadata?.chunk_index) || 0) - (Number(b.metadata?.chunk_index) || 0)
    );

    const fileSection: string[] = [`--- File: ${fileName} ---`];

    for (const chunk of chunks) {
      const chunkTokens = estimateTokens(chunk.content);
      if (totalTokens + chunkTokens > maxTokens && sections.length > 0) break;
      fileSection.push(chunk.content);
      totalTokens += chunkTokens;
    }

    if (fileSection.length > 1) {
      sections.push(fileSection.join('\n\n'));
    }
  }

  if (sections.length === 0) return null;
  return sections.join('\n\n') +
    '\n\nUse the document content above to answer questions about these files. Quote specific parts when relevant.';
}

function buildRAGBlock(
  ragContext: RetrievedContext,
  budget: typeof V4_BUDGETS[string]
): string | null {
  const sections: string[] = [];
  let totalTokens = 0;

  // HOT memories — always injected (up to 60% of combined budget)
  const hotBudget = budget.hot;
  const hotContent = formatMemories(ragContext.hot, hotBudget);
  if (hotContent) {
    sections.push(hotContent);
    totalTokens += estimateTokens(hotContent);
  }

  // WARM memories — if budget allows
  if (totalTokens < hotBudget + budget.warm) {
    const warmContent = formatMemories(ragContext.warm, budget.warm);
    if (warmContent) {
      sections.push(warmContent);
      totalTokens += estimateTokens(warmContent);
    }
  }

  // COLD memories — fill remaining
  if (totalTokens < hotBudget + budget.warm + budget.cold) {
    const coldContent = formatMemories(ragContext.cold, budget.cold);
    if (coldContent) {
      sections.push(coldContent);
    }
  }

  if (sections.length === 0) return null;
  return sections.join('\n\n') + '\n\nUse this context naturally when relevant. Do not mention that you retrieved it from memory.';
}

function formatMemories(memories: RetrievedResult[], maxTokens: number): string {
  if (memories.length === 0) return '';

  // Sort by density × score for priority
  const scored = memories.map(m => ({
    ...m,
    priority: computeDensity(m.content) * temperatureWeight(m.temperature) * m.score,
  }));
  scored.sort((a, b) => b.priority - a.priority);

  const lines: string[] = [];
  let tokens = 0;

  for (const m of scored) {
    const line = formatMemoryLine(m);
    const lineTokens = estimateTokens(line);
    if (tokens + lineTokens > maxTokens && lines.length > 0) break;
    lines.push(line);
    tokens += lineTokens;
  }

  return lines.join('\n');
}

function formatMemoryLine(m: RetrievedResult): string {
  const timeAgo = formatTimeAgo(m.created_at);
  if (m.source_type === 'anti_memory') {
    return `⚠️ ${m.content}`;
  }
  if (m.source_type === 'fact') {
    return `• ${m.content}`;
  }
  if (m.source_type === 'document') {
    return `📎 ${m.content}`;
  }
  return `[${m.source_type}, ${timeAgo}] ${m.content}`;
}

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/**
 * Adaptive window size based on classification and RAG results.
 */
function determineWindowSize(
  classification: ClassificationResult,
  ragContext: RetrievedContext | null
): number {
  if (classification.intent === 'chitchat') return 2;
  if (classification.workingMemoryPhase === 'debugging') return 8;
  if (classification.workingMemoryPhase === 'implementing') return 6;
  if (classification.complexity === 'high') return 7;

  const ragCount = ragContext
    ? ragContext.hot.length + ragContext.warm.length + ragContext.cold.length
    : 0;
  if (ragCount >= 8) return 3; // RAG is carrying the weight
  return 5;
}

function trimToTokenBudget(
  messages: Array<{ role: string; content: string }>,
  maxTokens: number
): Array<{ role: 'user' | 'assistant' | 'system'; content: string }> {
  if (messages.length === 0) return [];

  const result: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [];
  let totalTokens = 0;

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
