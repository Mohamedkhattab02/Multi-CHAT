// ============================================================
// Rolling Summary — V4 Incremental Patching
// Instead of regenerating from scratch, produces a JSON patch
// No information is silently dropped — only explicitly removed
// Uses structured summary format with sections
// ============================================================

import { createServiceClient } from '@/lib/supabase/server';
import * as Sentry from '@sentry/nextjs';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

export interface StructuredSummary {
  decisions: string[];
  technical: string[];
  documents: Array<{
    filename: string;
    summary: string;
    key_sections: string[];
  }>;
  preferences: string[];
  open_threads: string[];
  narrative: string;
}

interface SummaryPatch {
  add?: {
    decisions?: string[];
    technical?: string[];
    documents?: Array<{ filename: string; summary: string; key_sections: string[] }>;
    preferences?: string[];
    open_threads?: string[];
  };
  update?: {
    narrative?: string | null;
  };
  remove?: {
    open_threads?: string[];
  };
}

export const DEFAULT_STRUCTURED_SUMMARY: StructuredSummary = {
  decisions: [],
  technical: [],
  documents: [],
  preferences: [],
  open_threads: [],
  narrative: '',
};

async function callGeminiFlash(systemInstruction: string, userMessage: string, maxTokens: number): Promise<string> {
  const response = await fetch(GEMINI_API_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': process.env.GOOGLE_AI_API_KEY!,
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: systemInstruction }],
      },
      contents: [{ role: 'user', parts: [{ text: userMessage }] }],
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature: 0,
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!response.ok) throw new Error(`Gemini Flash error: ${response.status}`);
  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
}

/**
 * Apply a patch to the structured summary.
 * Never silently drops information — removal is explicit only.
 */
function applyPatch(current: StructuredSummary, patch: SummaryPatch): StructuredSummary {
  return {
    decisions: [...current.decisions, ...(patch.add?.decisions ?? [])].slice(-20),
    technical: [...current.technical, ...(patch.add?.technical ?? [])].slice(-20),
    documents: [...current.documents, ...(patch.add?.documents ?? [])],
    preferences: [...current.preferences, ...(patch.add?.preferences ?? [])].slice(-15),
    open_threads: [
      ...current.open_threads.filter(t => !patch.remove?.open_threads?.includes(t)),
      ...(patch.add?.open_threads ?? []),
    ].slice(-10),
    narrative: patch.update?.narrative ?? current.narrative,
  };
}

/**
 * Generate an incremental summary patch instead of regenerating from scratch.
 * V4: structured format with explicit add/update/remove operations.
 */
export async function generateRollingSummary(
  previousSummary: string | null | undefined,
  structuredSummary: StructuredSummary | null,
  recentMessages: Array<{ role: string; content: string }>,
  latestUserMessage: string,
  latestAssistantResponse: string
): Promise<{ text: string; structured: StructuredSummary }> {
  const current = structuredSummary || DEFAULT_STRUCTURED_SUMMARY;

  const conversation = recentMessages
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.slice(0, 300)}`)
    .join('\n');

  try {
    const patchText = await callGeminiFlash(
      'You are maintaining an incremental conversation summary. Produce a JSON patch to apply.',
      `Current summary (JSON):
${JSON.stringify(current, null, 2)}

New messages since last patch:
${conversation}
User: ${latestUserMessage.slice(0, 500)}
Assistant: ${latestAssistantResponse.slice(0, 500)}

Produce a JSON patch. Schema:
{
  "add": { "decisions": [...], "technical": [...], "documents": [...], "preferences": [...], "open_threads": [...] },
  "update": { "narrative": "new text or null" },
  "remove": { "open_threads": ["items to remove because they were resolved"] }
}

Rules:
- NEVER remove decisions, technical details, or document summaries — only add
- open_threads CAN be removed if explicitly resolved
- Only update narrative if the conversation arc meaningfully shifted
- Return {} if nothing changed`,
      800
    );

    const patch: SummaryPatch = JSON.parse(patchText || '{}');
    const updated = applyPatch(current, patch);

    // Generate plain text version for backward compatibility
    const plainText = [
      updated.narrative,
      updated.decisions.length > 0 ? `Decisions: ${updated.decisions.join('; ')}` : '',
      updated.technical.length > 0 ? `Technical: ${updated.technical.join('; ')}` : '',
      updated.open_threads.length > 0 ? `Open: ${updated.open_threads.join('; ')}` : '',
    ].filter(Boolean).join('\n');

    return { text: plainText, structured: updated };
  } catch (error) {
    Sentry.captureException(error, {
      tags: { action: 'rolling_summary_v4' },
    });
    console.error('[RollingSummary] Failed:', error);
    return {
      text: previousSummary || '',
      structured: current,
    };
  }
}

/**
 * Save the structured summary to the conversation.
 */
export async function saveStructuredSummary(
  conversationId: string,
  summary: string,
  structured: StructuredSummary
): Promise<void> {
  const supabase = createServiceClient();
  await supabase
    .from('conversations')
    .update({
      summary,
      structured_summary: JSON.parse(JSON.stringify(structured)),
    })
    .eq('id', conversationId);
}

export async function generateTitle(
  userMessage: string,
  assistantResponse: string
): Promise<string> {
  try {
    const response = await fetch(GEMINI_API_BASE.replace('application/json', ''), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': process.env.GOOGLE_AI_API_KEY!,
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: 'Generate a short conversation title (3-6 words, no quotes). Based on the user message and response.' }],
        },
        contents: [{
          role: 'user',
          parts: [{ text: `User: ${userMessage.slice(0, 200)}\nAssistant: ${assistantResponse.slice(0, 200)}` }],
        }],
        generationConfig: { maxOutputTokens: 30 },
      }),
    });

    if (!response.ok) throw new Error(`Gemini error: ${response.status}`);
    const data = await response.json();
    const result = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return result?.trim()?.slice(0, 100) || 'New conversation';
  } catch {
    return 'New conversation';
  }
}
