// ============================================================
// Smart Intent Classifier — Layer 1 of 7-layer memory system
// Routes queries to the best model based on intent + complexity
// Uses Gemini 2.5 Flash for classification (fast + cheap)
// ============================================================

import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
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

// ── Complexity-based model routing ──
// Maps user-selected model → simpler variant for easy questions
const MODEL_DOWNGRADE: Record<string, string> = {
  'gpt-5.1':        'gpt-5-mini',
  'gemini-3.1-pro':  'gemini-3-flash',
  'glm-4.7':        'glm-4.6',
};

// Maps user-selected model → stronger variant for hard questions
const MODEL_UPGRADE: Record<string, string> = {
  'gpt-5-mini':     'gpt-5.1',
  'gemini-3-flash':  'gemini-3.1-pro',
  'glm-4.6':        'glm-4.7',
};

/**
 * Given the user's chosen model and classified complexity,
 * return the optimal model variant.
 *   - low  → downgrade to cheap/fast variant
 *   - high → upgrade to strong/thinking variant
 *   - medium → keep as-is
 */
export function routeByComplexity(userModel: string, complexity: string): string {
  if (complexity === 'low' && MODEL_DOWNGRADE[userModel]) {
    return MODEL_DOWNGRADE[userModel];
  }
  if (complexity === 'high' && MODEL_UPGRADE[userModel]) {
    return MODEL_UPGRADE[userModel];
  }
  return userModel;
}

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

  // Fast path: short/simple messages (greetings, chitchat) — skip LLM call
  const trimmed = message.trim();
  if (trimmed.split(/\s+/).length <= 5 && /^(hi|hello|hey|שלום|مرحبا|أهلا|thanks|thank you|ok|bye|good morning|good night|בוקר טוב|לילה טוב|מה נשמע|מה שלומך|מה קורה|how are you|כן|לא|תודה|يا هلا|شكرا|كيف حالك|صباح الخير|مساء الخير|אהלן|היי)/i.test(trimmed)) {
    return {
      intent: 'chitchat',
      complexity: 'low',
      needsRAG: false,
      needsInternet: false,
      hasImageInput: false,
      needsImageGeneration: false,
      routeOverride: 'none',
      suggestedModel: 'auto',
      language: 'auto',
      mainTopic: 'chitchat',
    };
  }

  // Full LLM classification using Gemini 2.5 Flash with JSON mode
  try {
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY!);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: {
        maxOutputTokens: 1024,
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            intent: { type: SchemaType.STRING, format: 'enum', enum: ['question', 'code', 'analysis', 'chitchat', 'creative', 'command', 'image_gen', 'web_search'] },
            complexity: { type: SchemaType.STRING, format: 'enum', enum: ['low', 'medium', 'high'] },
            needsRAG: { type: SchemaType.BOOLEAN },
            needsInternet: { type: SchemaType.BOOLEAN },
            hasImageInput: { type: SchemaType.BOOLEAN },
            needsImageGeneration: { type: SchemaType.BOOLEAN },
            routeOverride: { type: SchemaType.STRING, format: 'enum', enum: ['gemini-3-flash', 'gemini-3.1-flash-image', 'none'] },
            suggestedModel: { type: SchemaType.STRING },
            language: { type: SchemaType.STRING },
            mainTopic: { type: SchemaType.STRING },
          },
          required: ['intent', 'complexity', 'needsRAG', 'needsInternet', 'hasImageInput', 'needsImageGeneration', 'routeOverride', 'suggestedModel', 'language', 'mainTopic'],
        },
      },
    });

    const result = await model.generateContent({
      contents: [
        {
          role: 'user',
          parts: [{
            text: `You are a multilingual query classifier. The user message can be in ANY language (English, Hebrew, Arabic, etc.). The language does NOT affect complexity — classify based on the MEANING, not the language.

COMPLEXITY RULES (apply equally to ALL languages):
- low: greetings (hi, שלום, مرحبا), chitchat (מה נשמע, how are you, كيف حالك), simple factual questions, short translations, simple math, yes/no questions, small talk
- medium: explanations, summaries, moderate code questions, creative writing
- high: ONLY for complex code generation/debugging, deep multi-step analysis, research papers, architecture design — must be genuinely difficult

EXAMPLES:
- "שלום מה שלומך" → complexity:low, intent:chitchat
- "מה זה פייתון" → complexity:low, intent:question
- "תסביר לי מה זה API" → complexity:medium, intent:question
- "כתוב לי פונקציה שממיינת מערך" → complexity:medium, intent:code
- "כתוב לי מערכת אימות מלאה עם JWT" → complexity:high, intent:code
- "hi" → complexity:low, intent:chitchat
- "explain quantum computing" → complexity:medium, intent:question

ROUTING RULES:
- If query needs real-time data, current info, or internet → routeOverride:"gemini-3-flash", needsInternet:true
- If query asks to generate/create/draw an image → routeOverride:"gemini-3.1-flash-image", needsImageGeneration:true
- chitchat/greetings → needsRAG:false, complexity:low
- Simple code (single function, short snippet) → needsRAG:false, complexity:medium
- Complex code (full system, debugging, architecture) → needsRAG:true, complexity:high
- Simple factual → needsRAG:false, complexity:low
- Explanations → needsRAG:true, complexity:medium or high depending on depth

User message: ${message}`,
          }],
        },
      ],
    });

    const text = result.response.text();

    // With responseMimeType: 'application/json', Gemini returns clean JSON
    // But still extract from possible markdown wrapping as safety net
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('[Classifier] No JSON found in response, raw text:', text.slice(0, 500));
      return FALLBACK;
    }

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
