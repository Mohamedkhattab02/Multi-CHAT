// ============================================================
// Smart Intent Classifier — Layer 1 of 7-layer memory system
// Routes queries to the best model based on intent + complexity
// Uses GLM 4.7 for classification (cheapest model)
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

const IMAGE_GEN_PATTERNS = /\b(צור תמונה|generate image|create image|draw|paint|illustrate|ציור|תמונה של|make a picture|design)\b/i;
const WEB_SEARCH_PATTERNS = /\b(מזג אוויר|weather|today|latest|current|news|חדשות|score|price|מחיר|שער|stock|search|חפש|what happened|who won)\b/i;

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
  mainTopic: 'unknown',
};

export async function classifyIntent(
  message: string,
  hasImageAttachment: boolean = false
): Promise<ClassificationResult> {
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
      suggestedModel: 'gemini-3-flash',
      language: 'auto',
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
      suggestedModel: 'gemini-3.1-flash-image',
      language: 'auto',
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
      suggestedModel: 'gemini-3-flash',
      language: 'auto',
      mainTopic: 'web search',
    };
  }

  // Full LLM classification for complex queries
  try {
    const response = await fetch('https://open.bigmodel.cn/api/v4/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'glm-4-7b',
        max_tokens: 300,
        messages: [
          {
            role: 'system',
            content: `Classify the user message. Return ONLY valid JSON:
{"intent":"question|code|analysis|chitchat|creative|command|image_gen|web_search",
"complexity":"low|medium|high",
"needsRAG":true|false,
"needsInternet":true|false,
"hasImageInput":false,
"needsImageGeneration":true|false,
"routeOverride":"gemini-3-flash|gemini-3.1-flash-image|none",
"suggestedModel":"auto",
"language":"en|he|ar|auto",
"mainTopic":"brief topic"}

ROUTING RULES:
- If query needs real-time data, current info, or internet → routeOverride:"gemini-3-flash", needsInternet:true
- If query asks to generate/create/draw an image → routeOverride:"gemini-3.1-flash-image", needsImageGeneration:true
- chitchat/greetings → needsRAG:false, complexity:low
- Code/analysis → needsRAG:true, complexity:high
- Explanations → needsRAG:true, complexity:high`,
          },
          { role: 'user', content: message },
        ],
      }),
    });

    if (!response.ok) throw new Error(`GLM classifier error: ${response.status}`);

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';

    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in classifier response');

    const parsed = JSON.parse(jsonMatch[0]);
    return ClassificationSchema.parse(parsed);
  } catch (error) {
    Sentry.captureException(error, {
      tags: { action: 'classify_intent' },
      extra: { messageLength: message.length },
    });
    console.error('[Classifier] Failed, using fallback:', error);
    return FALLBACK;
  }
}
