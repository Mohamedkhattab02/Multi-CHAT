// ============================================================
// Extract Memories — Layer 5 of 7-layer memory system
// Extracts user facts/preferences/goals from conversation
// Uses Gemini 2.0 Flash (fast + cheap) for extraction
// Runs every 5 messages (called from route.ts)
// ============================================================

import { createServiceClient } from '@/lib/supabase/server';
import * as Sentry from '@sentry/nextjs';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

export async function extractMemories(
  userId: string,
  message: string,
  response: string
): Promise<void> {
  try {
    const geminiResponse = await fetch(GEMINI_API_BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': process.env.GOOGLE_AI_API_KEY!,
      },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [{
            text: `Extract facts about the user from this conversation. Return ONLY a valid JSON array, no markdown, no explanation.

Each item: {"type":"fact|preference|goal|skill|opinion","content":"...","confidence":0.0-1.0}

Rules:
- Only extract clearly stated personal information
- "fact": things about the user (name, job, location, etc.)
- "preference": things the user likes/dislikes
- "goal": things the user wants to achieve
- "skill": things the user knows or is learning
- "opinion": views the user expressed
- Return [] if nothing clearly extractable

User: "${message.slice(0, 1000)}"
Assistant: "${response.slice(0, 500)}"`,
          }],
        }],
        generationConfig: {
          maxOutputTokens: 500,
          temperature: 0,
          responseMimeType: 'application/json',
        },
      }),
    });

    if (!geminiResponse.ok) {
      throw new Error(`Gemini error: ${geminiResponse.status}`);
    }

    const geminiData = await geminiResponse.json();
    const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '[]';

    let memories;
    try {
      const parsed = JSON.parse(text);
      memories = Array.isArray(parsed) ? parsed : [];
    } catch {
      const match = text.match(/\[[\s\S]*\]/);
      memories = match ? JSON.parse(match[0]) : [];
    }

    if (memories.length === 0) return;

    const validTypes = ['fact', 'preference', 'goal', 'skill', 'opinion'];
    const rows = memories
      .filter((m: { content?: string }) => m.content && typeof m.content === 'string')
      .map((m: { type?: string; content?: string; confidence?: number }) => ({
        user_id: userId,
        type: validTypes.includes(m.type || '') ? m.type : 'fact',
        content: String(m.content).slice(0, 500),
        confidence: Math.min(Math.max(Number(m.confidence) || 0.5, 0), 1),
      }));

    if (rows.length > 0) {
      const supabase = createServiceClient();
      await supabase.from('memories').insert(rows);
    }
  } catch (error) {
    Sentry.captureException(error, {
      tags: { action: 'extract_memories' },
    });
    console.error('[ExtractMemories] Failed:', error);
  }
}
