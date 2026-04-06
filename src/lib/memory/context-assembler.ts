import type { TemperaturedResult } from './rag-pipeline';
import { estimateInformationDensity, estimateTokens } from './token-density';

// --- Temperature-Based Injection ---
function injectByTemperatureAndDensity(memories: TemperaturedResult[], budget: number): string {
  const sortByDensity = (arr: TemperaturedResult[]) =>
    [...arr].sort((a, b) => estimateInformationDensity(b.content) - estimateInformationDensity(a.content));

  const hot = sortByDensity(memories.filter(m => m.temperature === 'hot'));
  const warm = sortByDensity(memories.filter(m => m.temperature === 'warm'));
  const cold = sortByDensity(memories.filter(m => m.temperature === 'cold'));

  let used = 0;
  const parts: string[] = [];

  for (const m of hot) {
    const t = estimateTokens(m.content);
    if (used + t > budget * 0.6) break;
    parts.push(`[ Relevant Memory ] ${m.content}`);
    used += t;
  }
  for (const m of warm) {
    const t = estimateTokens(m.content);
    if (used + t > budget * 0.85) break;
    parts.push(`[ Related Context ] ${m.content}`);
    used += t;
  }
  for (const m of cold) {
    const t = estimateTokens(m.content);
    if (used + t > budget) break;
    parts.push(`[ Background ] ${m.content}`);
    used += t;
  }

  return parts.join('\n\n');
}

// --- Adaptive Window ---
function determineWindowSize(classification: any, ragResultCount: number): number {
  if (classification.workingMemoryPhase === 'debugging') return 8;
  if (classification.workingMemoryPhase === 'implementing') return 6;
  if (ragResultCount >= 5) return 3;
  if (classification.complexity === 'high') return 7;
  if (classification.intent === 'code') return 7;
  if (classification.intent === 'chitchat') return 2;
  return 5;
}

function smartTrimMessages(messages: any[], windowSize: number): any[] {
  if (messages.length <= windowSize) return messages;
  const recent = messages.slice(-windowSize);
  // Keep important older messages (with attachments or code blocks or long content)
  const importantOlder = messages.slice(0, -windowSize).filter(m =>
    m.attachments?.length > 0 || m.content?.includes('```') || (m.content?.length || 0) > 1000
  );
  return [...importantOlder.slice(-2), ...recent];
}

// --- Main Assembler ---
export function assembleContext(params: {
  model: string;
  userProfile: any;
  ragContext: string;
  temperaturedResults: TemperaturedResult[];
  messages: any[];
  workingMemory: any;
  documentRegistry: any[];
  structuredSummary: any;
  classification: any;
  language: string;
}) {
  const BUDGETS: Record<string, { system: number; rag: number; history: number }> = {
    'gemini-3.1-pro': { system: 5000, rag: 5000, history: 50000 },
    'gemini-3-flash': { system: 3000, rag: 3000, history: 30000 },
    'gpt-5.1': { system: 5000, rag: 5000, history: 30000 },
    'gpt-5-mini': { system: 3000, rag: 3000, history: 20000 },
    'glm-5': { system: 5000, rag: 5000, history: 30000 },
  };

  const budget = BUDGETS[params.model] || BUDGETS['gemini-3.1-pro'];

  // 1. STABLE PREFIX (Cacheable by Gemini/OpenAI)
  let systemPrompt = `You are a highly capable AI assistant. Respond in the user's language (${params.language}).`;

  if (params.userProfile?.expertise && params.userProfile.expertise !== 'general') {
    systemPrompt += `\n\nUser Expertise: ${params.userProfile.expertise}`;
  }

  if (params.userProfile?.preferences && Object.keys(params.userProfile.preferences).length > 0) {
    systemPrompt += `\nUser Preferences: ${JSON.stringify(params.userProfile.preferences)}`;
  }

  if (params.documentRegistry?.length > 0) {
    systemPrompt += '\n\n📎 Documents in this conversation:\n';
    params.documentRegistry.forEach((d: any) => {
      systemPrompt += `- "${d.filename}" (${d.chunk_count} chunks): ${d.summary}\n`;
    });
  }

  if (params.workingMemory?.current_task) {
    const wm = params.workingMemory;
    systemPrompt += `\n\n🎯 Current Task Context`;
    systemPrompt += `\nTask: ${wm.current_task}`;
    if (wm.sub_tasks?.length > 0) systemPrompt += `\nSub-tasks: ${wm.sub_tasks.join(', ')}`;
    systemPrompt += `\nPhase: ${wm.phase}`;
    if (wm.active_entities?.length > 0) systemPrompt += `\nActive entities: ${wm.active_entities.join(', ')}`;
    if (wm.last_decision) systemPrompt += `\nLast decision: ${wm.last_decision}`;
  }

  if (params.structuredSummary?.summary) {
    systemPrompt += `\n\n📜 Conversation Summary\n${params.structuredSummary.summary}`;
  }

  // 2. VARIABLE SUFFIX
  const assembledMessages: any[] = [];

  const ragText = injectByTemperatureAndDensity(params.temperaturedResults, budget.rag);
  if (ragText) {
    assembledMessages.push(
      { role: 'user', content: `[Relevant context from memory]:\n${ragText}` },
      { role: 'assistant', content: 'I have this context available. Let me use it to help you.' }
    );
  }

  const windowSize = determineWindowSize(params.classification, params.temperaturedResults.length);
  const trimmedMessages = smartTrimMessages(params.messages, windowSize);
  assembledMessages.push(...trimmedMessages);

  return { systemPrompt, messages: assembledMessages };
}
