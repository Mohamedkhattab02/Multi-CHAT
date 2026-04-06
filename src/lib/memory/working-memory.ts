import { createClient } from '@supabase/supabase-js';

export interface WorkingMemory {
  current_task: string | null;
  sub_tasks: string[];
  active_entities: string[];
  last_decision: string | null;
  phase: 'greeting' | 'exploration' | 'deep_work' | 'review' | 'conclusion' | 'idle';
  updated_at: string | null;
}

const DEFAULT_WM: WorkingMemory = {
  current_task: null,
  sub_tasks: [],
  active_entities: [],
  last_decision: null,
  phase: 'idle',
  updated_at: null,
};

const WM_UPDATE_PROMPT = `Update working memory JSON. Return ONLY valid JSON, no markdown:
{"current_task":null|string,"sub_tasks":[max 5],"active_entities":[max 10],"last_decision":null|string,"phase":"greeting|exploration|deep_work|review|conclusion|idle"}

Rules:
- Do NOT reset fields unless the task has clearly changed
- Add to arrays, do not remove unless the item was explicitly resolved
- Max 5 sub_tasks, max 10 active_entities (drop oldest if over)

Previous state:
{prev}

User message:
{user}

Assistant response:
{asst}`;

async function callGLMFlash(prompt: string): Promise<string> {
  const res = await fetch('https://open.bigmodel.cn/api/v4/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.GLM_API_KEY}` },
    body: JSON.stringify({ model: 'glm-4-7b', max_tokens: 250, temperature: 0.1, messages: [{ role: 'user', content: prompt }] }),
  });
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

/**
 * Updates working memory for a conversation.
 * Fetches current WM from DB internally — caller just passes IDs and messages.
 * Throttled: skips if last update was <3 minutes ago (unless transitioning from idle).
 */
export async function updateWorkingMemory(
  conversationId: string,
  userMessage: string,
  assistantMessage: string,
  intent: string
): Promise<WorkingMemory> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: conv } = await supabase
    .from('conversations')
    .select('working_memory')
    .eq('id', conversationId)
    .single();

  const currentWM: WorkingMemory = conv?.working_memory || DEFAULT_WM;

  // Skip chitchat when already idle
  if (intent === 'chitchat' && currentWM.phase === 'idle') return currentWM;

  const timeSinceUpdate = currentWM.updated_at
    ? Date.now() - new Date(currentWM.updated_at).getTime()
    : Infinity;

  // Don't update too frequently (except when transitioning from idle, or for code/analysis)
  if (timeSinceUpdate < 3 * 60 * 1000) {
    if (currentWM.phase !== 'idle' && intent !== 'code' && intent !== 'analysis') {
      return currentWM;
    }
  }

  try {
    const prompt = WM_UPDATE_PROMPT
      .replace('{prev}', JSON.stringify(currentWM))
      .replace('{user}', userMessage.slice(0, 400))
      .replace('{asst}', assistantMessage.slice(0, 400));

    const raw = await callGLMFlash(prompt);
    const cleaned = raw.replace(/```json?\s*/gi, '').replace(/```/g, '').trim();
    const updated: WorkingMemory = JSON.parse(cleaned);
    updated.updated_at = new Date().toISOString();

    await supabase
      .from('conversations')
      .update({ working_memory: updated })
      .eq('id', conversationId);

    return updated;
  } catch (error) {
    console.error('[Working Memory] Update failed:', error);
    return currentWM;
  }
}
