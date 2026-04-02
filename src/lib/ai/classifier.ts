import { GoogleGenerativeAI } from '@google/generative-ai';
import { z } from 'zod';

// ============================================================
// INTENT CLASSIFIER — Smart routing with special overrides
// Uses regex fast-path first (free), then Gemini Flash for
// full classification (cheap + reliable)
// ============================================================

const ClassificationSchema = z.object({
  intent: z.enum(['question', 'code', 'analysis', 'chitchat', 'creative', 'command', 'image_gen', 'web_search', 'image_analysis']),
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

const IMAGE_GEN_PATTERNS = /\b(צור תמונה|generate image|create image|draw|paint|illustrate|ציור|תמונה של|make an image|design an image)\b/i;
const WEB_SEARCH_PATTERNS = /\b(מזג אוויר|weather|today|latest|current|news|חדשות|score|price|מחיר|שער|stock|search|חפש|right now|at the moment)\b/i;

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
  // Fast path: image attached → vision route
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

  // Fast path: real-time web search request
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

  // Full LLM classification via Gemini Flash (fast + cheap)
  try {
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY ?? '');
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 300,
      },
    });

    const prompt = `Classify the user message. Return ONLY valid JSON with no markdown or explanation:
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

RULES:
- real-time/current/internet queries → routeOverride:"gemini-3-flash", needsInternet:true
- image generation → routeOverride:"gemini-3.1-flash-image", needsImageGeneration:true
- chitchat/greetings → needsRAG:false, complexity:low
- code/analysis/explain → needsRAG:true, complexity:high

User message: "${message.slice(0, 500)}"`;

    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();

    // Strip markdown fences if present
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const parsed = JSON.parse(cleaned);
    return ClassificationSchema.parse(parsed);
  } catch (error) {
    console.error('[Classifier] Gemini Flash failed, using safe fallback:', error);
    return FALLBACK;
  }
}
