// ============================================================
// Smart Intent Classifier — Layer 1 of V4 memory system
// Routes queries to the best model based on intent + complexity
// Uses Gemini 2.5 Flash for classification (fast + cheap)
// V4: adds workingMemoryPhase, hasCodeMarkers, referencesDocument
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
  language: z.enum(['en', 'he', 'ar', 'mixed']),
  mainTopic: z.string(),
  reasoning: z.string().optional(),
  // V4 additions
  workingMemoryPhase: z.enum(['planning', 'implementing', 'debugging', 'reviewing', 'none']).optional(),
  hasCodeMarkers: z.boolean().optional(),
  referencesDocument: z.boolean().optional(),
});

export type ClassificationResult = z.infer<typeof ClassificationSchema>;

const IMAGE_GEN_PATTERNS = /\b(צור תמונה|generate image|create image|draw|paint|illustrate|ציור|תמונה של|make a picture|design)\b/i;
const WEB_SEARCH_PATTERNS = /\b(מזג אוויר|weather|today|latest|current|news|חדשות|score|price|מחיר|שער|stock|search|חפש|what happened|who won)\b/i;

// Fast language detection (no LLM)
function detectLanguageFast(text: string): 'en' | 'he' | 'ar' | 'mixed' {
  const hasHebrew = /[\u0590-\u05FF]/.test(text);
  const hasArabic = /[\u0600-\u06FF]/.test(text);
  const hasLatin = /[a-zA-Z]/.test(text);
  if ((hasHebrew || hasArabic) && hasLatin) return 'mixed';
  if (hasHebrew && hasArabic) return 'mixed';
  if (hasHebrew) return 'he';
  if (hasArabic) return 'ar';
  return 'en';
}

// Fast code marker detection
function detectCodeMarkers(text: string): boolean {
  return /```/.test(text) ||
    /\b[a-z][a-zA-Z]+[A-Z][a-zA-Z]*\b/.test(text) ||  // camelCase
    /\b[a-z]+_[a-z]+\b/.test(text) ||                    // snake_case
    /\.\w{1,4}$/.test(text.split('\n')[0] || '') ||       // file extensions
    /\b(function|const|let|var|import|export|class|def|return|async|await)\b/.test(text);
}

// Fast document reference detection
function detectDocumentReference(text: string): boolean {
  return /\b(file|document|PDF|upload|attachment|קובץ|מסמך|בקובץ|במסמך|in the attachment)\b/i.test(text);
}

const FALLBACK: ClassificationResult = {
  intent: 'question',
  complexity: 'medium',
  needsRAG: true,
  needsInternet: false,
  hasImageInput: false,
  needsImageGeneration: false,
  routeOverride: 'none',
  suggestedModel: 'auto',
  language: 'en',
  mainTopic: 'unknown',
  workingMemoryPhase: 'none',
  hasCodeMarkers: false,
  referencesDocument: false,
};

// ── Complexity-based model routing ──
const MODEL_DOWNGRADE: Record<string, string> = {
  'gpt-5.1':        'gpt-5-mini',
  'gemini-3.1-pro':  'gemini-3-flash',
  'glm-4.7':        'glm-4.6',
};

const MODEL_UPGRADE: Record<string, string> = {
  'gpt-5-mini':     'gpt-5.1',
  'gemini-3-flash':  'gemini-3.1-pro',
  'glm-4.6':        'glm-4.7',
};

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
  const language = detectLanguageFast(message);
  const hasCodeMarkers = detectCodeMarkers(message);
  const referencesDocument = detectDocumentReference(message);

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
      language,
      mainTopic: 'image analysis',
      workingMemoryPhase: 'none',
      hasCodeMarkers,
      referencesDocument,
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
      language,
      mainTopic: 'image generation',
      workingMemoryPhase: 'none',
      hasCodeMarkers: false,
      referencesDocument: false,
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
      language,
      mainTopic: 'web search',
      workingMemoryPhase: 'none',
      hasCodeMarkers: false,
      referencesDocument: false,
    };
  }

  // Fast path: short/simple messages (greetings, chitchat)
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
      language,
      mainTopic: 'chitchat',
      workingMemoryPhase: 'none',
      hasCodeMarkers: false,
      referencesDocument: false,
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
            language: { type: SchemaType.STRING, format: 'enum', enum: ['en', 'he', 'ar', 'mixed'] },
            mainTopic: { type: SchemaType.STRING },
            reasoning: { type: SchemaType.STRING },
            workingMemoryPhase: { type: SchemaType.STRING, format: 'enum', enum: ['planning', 'implementing', 'debugging', 'reviewing', 'none'] },
            hasCodeMarkers: { type: SchemaType.BOOLEAN },
            referencesDocument: { type: SchemaType.BOOLEAN },
          },
          required: ['intent', 'complexity', 'needsRAG', 'needsInternet', 'hasImageInput', 'needsImageGeneration', 'routeOverride', 'suggestedModel', 'language', 'mainTopic', 'workingMemoryPhase', 'hasCodeMarkers', 'referencesDocument'],
        },
      },
    });

    const result = await model.generateContent({
      contents: [
        {
          role: 'user',
          parts: [{
            text: `You are a router for a multi-model AI chat platform.
Your ONLY job: analyze the user message and return a single JSON object.
You do NOT answer the question. You ONLY classify and route.

COMPLEXITY RULES (apply equally to ALL languages):
- low: greetings, chitchat, simple factual questions, short translations, yes/no questions
- medium: explanations, summaries, moderate code questions, creative writing, single-step how-to
- high: ONLY for complex code generation/debugging, deep multi-step analysis, architecture design, math proofs
  DEFAULT when uncertain: "medium" (never guess high — expensive models cost more)

ROUTING RULES:
- If query needs real-time data → routeOverride:"gemini-3-flash", needsInternet:true
- If query asks to generate/create an image → routeOverride:"gemini-3.1-flash-image", needsImageGeneration:true
- chitchat/greetings → needsRAG:false, complexity:low
- needsRAG:true if complexity is "high", or medium+code/analysis, or references past conversation/documents
- IMPORTANT: PDF/document uploads are NOT images. hasImageInput:false for PDFs. Only set hasImageInput:true for actual image files (png, jpg, gif, etc.)
- IMPORTANT: routeOverride:"gemini-3.1-flash-image" is ONLY for image generation requests, NEVER for document/PDF questions

WORKING MEMORY PHASE:
- planning: user is designing, brainstorming, choosing approach
- implementing: user is building, writing code, executing steps
- debugging: user has a broken thing and is fixing it
- reviewing: user is checking, testing, asking "is this correct"
- none: chitchat, simple Q&A, image gen, web search

CODE MARKERS: true if message contains \`\`\`, function names (camelCase/snake_case), file extensions, code keywords
DOCUMENT REFERENCES: true if message mentions "file", "document", "PDF", "upload", "קובץ", "מסמך"

User message: ${message}`,
          }],
        },
      ],
    });

    const text = result.response.text();

    // Strip BOM and whitespace that Gemini sometimes prepends
    const cleaned = text.replace(/^\uFEFF/, '').trim();

    // Attempt 1: direct parse (works 99% of the time with responseMimeType=json)
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      // Attempt 2: extract JSON from text that might have wrapping
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.warn('[Classifier] No JSON found, raw text:', cleaned.slice(0, 500));
        return { ...FALLBACK, language, hasCodeMarkers, referencesDocument };
      }
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch {
        console.warn('[Classifier] Extracted text is not valid JSON:', jsonMatch[0].slice(0, 200));
        return { ...FALLBACK, language, hasCodeMarkers, referencesDocument };
      }
    }

    return ClassificationSchema.parse(parsed);
  } catch (error) {
    Sentry.captureException(error, {
      tags: { action: 'classify_intent' },
      extra: { messageLength: message.length },
    });
    console.error('[Classifier] Failed, using fallback:', error);
    return { ...FALLBACK, language, hasCodeMarkers, referencesDocument };
  }
}