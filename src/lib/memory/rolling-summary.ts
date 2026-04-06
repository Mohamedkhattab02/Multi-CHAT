import { generateGeminiFlash } from '@/lib/ai/gemini-flash'; // Assume a lightweight wrapper exists

const INCREMENTAL_SUMMARY_PROMPT = `You are maintaining a living document — a conversation summary.
You receive the CURRENT summary and NEW messages. UPDATE the summary, don't rewrite it.

RULES:
1. START from current summary — keep everything still relevant
2. ADD new information from new messages
3. REMOVE information that is outdated or contradicted
4. PRESERVE exact function names, variable names, file names, decisions
5. If a document was discussed, keep its filename + key findings
6. If code was written, keep function signatures (not full implementations)
7. DROP greetings, thanks, filler — KEEP unresolved questions
8. Keep original language

## Current Summary:
{currentSummary}

## New Messages to Integrate:
{newMessages}

Return ONLY the updated summary. Max 800 words.`;

export async function updateRollingSummary(
  conversationId: string,
  currentStructuredSummary: any | null,
  newMessages: Array<{ role: string; content: string }>,
  supabase: any
): Promise<void> {
  const messagesText = newMessages
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.slice(0, 500)}`)
    .join('\n');

  let prompt: string;

  if (!currentStructuredSummary) {
    prompt = `Summarize this conversation. Max 800 words. Preserve code references, decisions, and document mentions.\n\n${messagesText}`;
  } else {
    prompt = INCREMENTAL_SUMMARY_PROMPT
      .replace('{currentSummary}', JSON.stringify(currentStructuredSummary))
      .replace('{newMessages}', messagesText);
  }

  try {
    const updatedSummary = await generateGeminiFlash(prompt, 1200);
    
    await supabase.from('conversations')
      .update({
        structured_summary: { summary: updatedSummary, updated_at: new Date().toISOString() }
      })
      .eq('id', conversationId);
  } catch (error) {
    console.error('[Rolling Summary] Failed to update:', error);
  }
}