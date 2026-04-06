// ============================================================
// Extract Memories — V4
// Extracts user facts/preferences/goals from conversation
// V4: Semantic dedup check before insert, extended types,
//     anti-memory awareness
// ============================================================

import { createServiceClient } from '@/lib/supabase/server';
import { generateEmbedding } from '@/lib/ai/embeddings';
import { storeMemoryEmbedding } from '@/lib/memory/embed-store';
import * as Sentry from '@sentry/nextjs';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

const VALID_TYPES = [
  'fact', 'preference', 'goal', 'skill', 'opinion',
  'rejection', 'correction', 'constraint',
] as const;

export async function extractMemories(
  userId: string,
  message: string,
  response: string,
  conversationId?: string
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
            text: `Extract facts about the user from this conversation. Return ONLY a valid JSON array, no markdown.

Each item: {"type":"fact|preference|goal|skill|opinion|rejection|correction|constraint","content":"...","confidence":0.0-1.0}

Types:
- "fact": personal info (name, job, location)
- "preference": things user likes/dislikes
- "goal": things user wants to achieve
- "skill": things user knows or is learning
- "opinion": views expressed
- "rejection": user explicitly rejected an approach/solution
- "correction": user corrected a mistake
- "constraint": user stated a requirement/limitation

Rules:
- Only extract clearly stated personal information
- If user rejected/corrected something, capture WHAT was rejected and WHY
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

    const supabase = createServiceClient();

    for (const m of memories) {
      if (!m.content || typeof m.content !== 'string') continue;

      const type = VALID_TYPES.includes(m.type) ? m.type : 'fact';
      const content = String(m.content).slice(0, 500);
      const confidence = Math.min(Math.max(Number(m.confidence) || 0.5, 0), 1);

      // ═══ V4: Semantic dedup check ═══
      // Check if a similar memory already exists (threshold 0.92)
      try {
        const embedding = await generateEmbedding(content);
        const { data: similar } = await supabase.rpc('find_similar_memory', {
          target_user_id: userId,
          query_embedding: embedding,
          similarity_threshold: 0.92,
        });

        if (similar && similar.length > 0) {
          // Update existing memory's confidence if higher
          const existing = similar[0];
          if (confidence > existing.confidence) {
            await supabase
              .from('memories')
              .update({ confidence, content })
              .eq('id', existing.id);
          }
          continue; // Skip inserting duplicate
        }

        // Insert new memory
        const { data: inserted } = await supabase.from('memories').insert({
          user_id: userId,
          type,
          content,
          confidence,
          source_conversation_id: conversationId || null,
        }).select('id').single();

        // Embed the memory for future dedup and RAG
        if (inserted) {
          await storeMemoryEmbedding(
            userId,
            inserted.id,
            content,
            conversationId || '',
            type === 'rejection' || type === 'correction' ? 'anti_memory' : 'fact'
          );
        }
      } catch (dupError) {
        // If dedup check fails, still insert (better to have duplicates than lose memories)
        await supabase.from('memories').insert({
          user_id: userId,
          type,
          content,
          confidence,
          source_conversation_id: conversationId || null,
        });
      }
    }
  } catch (error) {
    Sentry.captureException(error, {
      tags: { action: 'extract_memories' },
    });
    console.error('[ExtractMemories] Failed:', error);
  }
}
