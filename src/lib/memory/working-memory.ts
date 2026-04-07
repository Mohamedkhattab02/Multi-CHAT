// ============================================================
// Working Memory — V4
// Tracks what the user is doing right now (task, phase, files)
// Stored on conversations.working_memory as JSONB
// Updated every 3 messages or on phase shifts
// ============================================================

import { createServiceClient } from '@/lib/supabase/server';
import type { ClassificationResult } from '@/lib/ai/classifier';
import * as Sentry from '@sentry/nextjs';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

export interface WorkingMemory {
  current_task: string | null;
  sub_tasks: string[];
  active_entities: string[];
  open_questions: string[];
  last_decision: string | null;
  phase: 'planning' | 'implementing' | 'debugging' | 'reviewing' | 'idle';
  updated_at: string | null;
}

export const DEFAULT_WORKING_MEMORY: WorkingMemory = {
  current_task: null,
  sub_tasks: [],
  active_entities: [],
  open_questions: [],
  last_decision: null,
  phase: 'idle',
  updated_at: null,
};

export async function getWorkingMemory(conversationId: string): Promise<WorkingMemory> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('conversations')
    .select('working_memory')
    .eq('id', conversationId)
    .single();

  if (!data?.working_memory) return DEFAULT_WORKING_MEMORY;
  return data.working_memory as unknown as WorkingMemory;
}

export async function updateWorkingMemory(
  conversationId: string,
  recentMessages: Array<{ role: string; content: string }>,
  classification: ClassificationResult
): Promise<WorkingMemory> {
  try {
    const current = await getWorkingMemory(conversationId);
    const supabase = createServiceClient();

    const messagesStr = recentMessages
      .slice(-5)
      .map(m => `${m.role}: ${m.content.slice(0, 300)}`)
      .join('\n');

    const response = await fetch(GEMINI_API_BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': process.env.GOOGLE_AI_API_KEY!,
      },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [{
            text: `You are maintaining a working memory buffer for a conversation.
Current state: ${JSON.stringify(current)}
Recent messages:
${messagesStr}
Classification hint: phase=${classification.workingMemoryPhase || 'none'}

Update the working memory. Return ONLY JSON matching this schema:
{ "current_task": string|null, "sub_tasks": string[], "active_entities": string[], "open_questions": string[], "last_decision": string|null, "phase": "planning|implementing|debugging|reviewing|idle" }

Rules:
- Do NOT reset fields unless the task has clearly changed
- Add to arrays; do not remove unless the item was explicitly resolved
- open_questions: track questions the user asked that haven't been fully answered yet. Remove when answered.
- If phase changed, explain in last_decision
- Max 5 items per array (drop oldest if over)
- If this is chitchat with no clear task, keep existing values`,
          }],
        }],
        generationConfig: {
          maxOutputTokens: 500,
          temperature: 0,
          responseMimeType: 'application/json',
        },
      }),
    });

    if (!response.ok) throw new Error(`Gemini error: ${response.status}`);

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const updated: WorkingMemory = {
      ...DEFAULT_WORKING_MEMORY,
      ...JSON.parse(text),
      updated_at: new Date().toISOString(),
    };

    await supabase
      .from('conversations')
      .update({ working_memory: JSON.parse(JSON.stringify(updated)) })
      .eq('id', conversationId);

    return updated;
  } catch (error) {
    Sentry.captureException(error, {
      tags: { action: 'update_working_memory' },
    });
    console.error('[WorkingMemory] Failed:', error);
    return await getWorkingMemory(conversationId);
  }
}
