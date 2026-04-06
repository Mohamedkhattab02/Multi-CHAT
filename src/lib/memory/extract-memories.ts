// ============================================================
// Extract Memories — Layer 5 of 7-layer memory system
// Extracts user facts/preferences/goals from conversation
// Uses Gemini 2.0 Flash (fast + cheap) for extraction
// V4: Includes semantic dedup via find_similar_memory RPC
// Runs every 5 messages (called from route.ts)
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { generateEmbedding } from '@/lib/ai/embeddings';
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

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    for (const m of memories) {
      if (!m.content || typeof m.content !== 'string') continue;

      const type = validTypes.includes(m.type || '') ? m.type : 'fact';
      const content = String(m.content).slice(0, 500);
      const confidence = Math.min(Math.max(Number(m.confidence) || 0.5, 0), 1);

      // V4: Semantic dedup — check if a very similar memory already exists
      const embedding = await generateEmbedding(content);
      const { data: similar } = await supabase.rpc('find_similar_memory', {
        target_user_id: userId,
        query_embedding: embedding,
        similarity_threshold: 0.92,
      });

      if (similar && similar.length > 0) {
        // Update existing memory's confidence if the new one is higher
        const existing = similar[0];
        if (confidence > existing.confidence) {
          await supabase
            .from('memories')
            .update({ confidence, content })
            .eq('id', existing.id);
        }
        // Skip inserting — it's a duplicate
        continue;
      }

      // No duplicate found — insert new memory
      const { data: newMemory } = await supabase
        .from('memories')
        .insert({ user_id: userId, type, content, confidence })
        .select('id')
        .single();

      // Also embed the memory for future dedup and RAG
      await supabase.from('embeddings').insert({
        user_id: userId,
        source_type: 'fact',
        source_id: newMemory?.id || null,
        content,
        embedding,
        metadata: { memory_type: type, is_active: true },
      });
    }
  } catch (error) {
    Sentry.captureException(error, {
      tags: { action: 'extract_memories' },
    });
    console.error('[ExtractMemories] Failed:', error);
  }
}
