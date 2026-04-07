// ============================================================
// Gemini Context Caching — reduces token costs for conversations
// with large system prompts (especially with document content).
// Caches the system instruction so subsequent messages reuse it.
// ============================================================

import { GoogleAICacheManager, type CachedContent } from '@google/generative-ai/server';
import * as Sentry from '@sentry/nextjs';
import { createServiceClient } from '@/lib/supabase/server';

const MODEL_MAP: Record<string, string> = {
  'gemini-3.1-pro': 'models/gemini-3.1-pro-preview',
  'gemini-3-flash': 'models/gemini-3-flash-preview',
};

// Minimum system prompt length to justify caching (tokens ≈ chars/4)
// Gemini requires at least 32,768 tokens for caching
const MIN_PROMPT_LENGTH_FOR_CACHE = 32768 * 4; // ~131072 chars

/**
 * Get or create a Gemini content cache for a conversation's system prompt.
 * Returns the CachedContent object if successful, null otherwise.
 */
export async function getOrCreateCache(params: {
  conversationId: string;
  systemPrompt: string;
  model: 'gemini-3.1-pro' | 'gemini-3-flash';
  existingCacheName: string | null;
}): Promise<CachedContent | null> {
  const { conversationId, systemPrompt, model, existingCacheName } = params;

  // Only cache large prompts (Gemini requires minimum 32k tokens)
  if (systemPrompt.length < MIN_PROMPT_LENGTH_FOR_CACHE) {
    return null;
  }

  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) return null;

  const cacheManager = new GoogleAICacheManager(apiKey);

  // Try to reuse existing cache
  if (existingCacheName) {
    try {
      const existing = await cacheManager.get(existingCacheName);
      if (existing && existing.name) {
        // Cache still valid — extend TTL
        await cacheManager.update(existingCacheName, {
          cachedContent: { ttlSeconds: 3600 }, // 1 hour
        });
        return existing;
      }
    } catch {
      // Cache expired or not found — create new one
      console.log(`[GeminiCache] Existing cache ${existingCacheName} expired, creating new`);
    }
  }

  // Create new cache
  try {
    const geminiModel = MODEL_MAP[model];
    if (!geminiModel) return null;

    const cache = await cacheManager.create({
      model: geminiModel,
      systemInstruction: systemPrompt,
      contents: [],
      ttlSeconds: 3600, // 1 hour
      displayName: `conv-${conversationId}`,
    });

    if (cache.name) {
      // Save cache name to conversation
      const supabase = createServiceClient();
      await supabase
        .from('conversations')
        .update({ gemini_cache_name: cache.name })
        .eq('id', conversationId);

      console.log(`[GeminiCache] Created cache ${cache.name} for conversation ${conversationId}`);
      return cache;
    }

    return null;
  } catch (error) {
    Sentry.captureException(error, {
      tags: { action: 'gemini_cache_create' },
      extra: { conversationId, promptLength: systemPrompt.length },
    });
    console.warn('[GeminiCache] Failed to create cache:', error);
    return null;
  }
}

/**
 * Delete a Gemini cache (e.g., when conversation is deleted).
 */
export async function deleteCache(cacheName: string): Promise<void> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey || !cacheName) return;

  try {
    const cacheManager = new GoogleAICacheManager(apiKey);
    await cacheManager.delete(cacheName);
  } catch {
    // Cache may already be expired — ignore
  }
}
