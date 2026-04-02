// ============================================================
// Smart Intent Classifier — Layer 1 of 7-layer memory system
// Routes queries to the best model based on intent + complexity
// Uses Gemini 2.0 Flash (non-thinking, reliable JSON mode)
// ============================================================

import { z } from 'zod';
import * as Sentry from '@sentry/nextjs';

const ClassificationSchema = z.object({
  intent: z.enum([
    'question', 'code', 'analysis', 'chitchat', 'creative',
    'command', 'image_gen', 'web_search', 'image_analysis',
  ]),
  complexity: z.enum(['low', 'medium', 'high']),
  needsRAG: z.boolean(),
  needsInternet: z.boolean(),
  hasImageInput: z.boolean(),
  needsImageGeneration: z.boolean(),
  routeOverride: z.enum(['gemini-3-flash', 'gemini-3.1-flash-image', 'none']),
  suggestedModel: z.string(),
  language: z.string(),
  mainTopic: z.string(),
});

export type ClassificationResult = z.infer<typeof ClassificationSchema>;

// ── Fast regex paths (skip LLM entirely) ──

const IMAGE_GEN_PATTERNS = /\b(צור תמונה|generate image|create image|draw|paint|illustrate|ציור|תמונה של|make a picture|design an image)\b/i;
const WEB_SEARCH_PATTERNS = /\b(מזג אוויר|weather|today|latest|current|news|חדשות|score|price|מחיר|שער|stock|search|חפש|what happened|who won|trending)\b/i;
const CODE_PATTERNS = /\b(code|function|class|debug|error|bug|implement|refactor|typescript|javascript|python|java|rust|go|cpp|c\+\+|sql|html|css|react|api|algorithm|regex|קוד|פונקציה|תכתוב|programm)\b/i;
const HEBREW_PATTERNS = /[\u0590-\u05FF]/;
const ARABIC_PATTERNS = /[\u0600-\u06FF]/;

const FALLBACK: ClassificationResult = {
  intent: 'question',
  complexity: 'medium',
  needsRAG: true,
  needsInternet: false,
  hasImageInput: false,
  needsImageGeneration: false,
  routeOverride: 'none',
  suggestedModel: 'auto',
  language: 'auto',
  mainTopic: 'general',
};

// ── Response schema for Gemini JSON mode ──

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    intent: {
      type: 'STRING',
      enum: ['question', 'code', 'analysis', 'chitchat', 'creative', 'command', 'image_gen', 'web_search', 'image_analysis'],
    },
    complexity: {
      type: 'STRING',
      enum: ['low', 'medium', 'high'],
    },
    needsRAG: { type: 'BOOLEAN' },
    needsInternet: { type: 'BOOLEAN' },
    hasImageInput: { type: 'BOOLEAN' },
    needsImageGeneration: { type: 'BOOLEAN' },
    routeOverride: {
      type: 'STRING',
      enum: ['gemini-3-flash', 'gemini-3.1-flash-image', 'none'],
    },
    suggestedModel: { type: 'STRING' },
    language: {
      type: 'STRING',
      enum: ['en', 'he', 'ar', 'auto'],
    },
    mainTopic: { type: 'STRING' },
  },
  required: [
    'intent', 'complexity', 'needsRAG', 'needsInternet',
    'hasImageInput', 'needsImageGeneration', 'routeOverride',
    'suggestedModel', 'language', 'mainTopic',
  ],
};

const SYSTEM_INSTRUCTION = `You are an intent classifier for a multi-model AI chat platform. Classify user messages into structured JSON.

INTENT TYPES:
- "chitchat": greetings, small talk, how are you, thanks
- "code": writing, debugging, explaining code, programming tasks
- "question": factual questions, explanations, how-to (non-code)
- "analysis": data analysis, comparisons, evaluations
- "creative": stories, poems, creative writing
- "command": system commands, settings changes
- "image_gen": requests to create/generate/draw images
- "web_search": needs current/real-time data (weather, news, prices, scores)
- "image_analysis": analyzing an uploaded image

COMPLEXITY:
- "low": simple greetings, yes/no questions, basic requests
- "medium": standard questions, moderate code tasks
- "high": complex analysis, multi-step code, deep explanations

ROUTING RULES:
- needsInternet=true → routeOverride:"gemini-3-flash" (has search grounding)
- needsImageGeneration=true → routeOverride:"gemini-3.1-flash-image"
- All other cases → routeOverride:"none"

LANGUAGE DETECTION:
- Hebrew script (אבגד) → "he"
- Arabic script (ابتث) → "ar"
- Latin script → "en"
- Mixed or unclear → "auto"

RAG (memory retrieval):
- needsRAG=true for: questions about past conversations, personal preferences, factual Q&A, code help
- needsRAG=false for: chitchat, greetings, image gen, web search

suggestedModel should always be "auto".`;

// ── Detect language from script ──

function detectLanguage(text: string): 'en' | 'he' | 'ar' | 'auto' {
  if (HEBREW_PATTERNS.test(text)) return 'he';
  if (ARABIC_PATTERNS.test(text)) return 'ar';
  return 'auto';
}

// ── Main classifier ──

export async function classifyIntent(
  message: string,
  hasImageAttachment: boolean = false
): Promise<ClassificationResult> {
  const detectedLang = detectLanguage(message);

  // Fast path: image attachment → Gemini Flash (vision)
  if (hasImageAttachment) {
    return {
      intent: 'image_analysis',
      complexity: 'medium',
      needsRAG: false,
      needsInternet: false,
      hasImageInput: true,
      needsImageGeneration: false,
      routeOverride: 'gemini-3-flash',
      suggestedModel: 'auto',
      language: detectedLang,
      mainTopic: 'image analysis',
    };
  }

  // Fast path: image generation request
  if (IMAGE_GEN_PATTERNS.test(message)) {
    return {
      intent: 'image_gen',
      complexity: 'medium',
      needsRAG: false,
      needsInternet: false,
      hasImageInput: false,
      needsImageGeneration: true,
      routeOverride: 'gemini-3.1-flash-image',
      suggestedModel: 'auto',
      language: detectedLang,
      mainTopic: 'image generation',
    };
  }

  // Fast path: web search needed
  if (WEB_SEARCH_PATTERNS.test(message)) {
    return {
      intent: 'web_search',
      complexity: 'medium',
      needsRAG: false,
      needsInternet: true,
      hasImageInput: false,
      needsImageGeneration: false,
      routeOverride: 'gemini-3-flash',
      suggestedModel: 'auto',
      language: detectedLang,
      mainTopic: 'web search',
    };
  }

  // Fast path: code-related (skip LLM, classify locally)
  if (CODE_PATTERNS.test(message)) {
    return {
      intent: 'code',
      complexity: message.length > 200 ? 'high' : 'medium',
      needsRAG: true,
      needsInternet: false,
      hasImageInput: false,
      needsImageGeneration: false,
      routeOverride: 'none',
      suggestedModel: 'auto',
      language: detectedLang,
      mainTopic: 'programming',
    };
  }

  // Full LLM classification for ambiguous queries
  try {
    const response = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': process.env.GOOGLE_AI_API_KEY!,
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: SYSTEM_INSTRUCTION }],
          },
          contents: [
            {
              role: 'user',
              parts: [{ text: `Classify this user message:\n\n${message}` }],
            },
          ],
          generationConfig: {
            maxOutputTokens: 256,
            temperature: 0,
            responseMimeType: 'application/json',
            responseSchema: RESPONSE_SCHEMA,
          },
        }),
      }
    );

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`Gemini classifier ${response.status}: ${errBody.slice(0, 200)}`);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      const finishReason = data.candidates?.[0]?.finishReason;
      throw new Error(`Empty classifier response (finishReason: ${finishReason})`);
    }

    const parsed = JSON.parse(text);
    return ClassificationSchema.parse(parsed);
  } catch (error) {
    Sentry.captureException(error, {
      tags: { action: 'classify_intent' },
      extra: { messageLength: message.length },
    });
    console.error('[Classifier] Failed, using fallback:', error);

    // Fallback with at least correct language
    return { ...FALLBACK, language: detectedLang };
  }
}
