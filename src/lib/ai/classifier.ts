import { z } from 'zod';

const ClassificationSchema = z.object({
  intent: z.enum(['question', 'code', 'analysis', 'chitchat', 'creative', 'command', 'image_gen', 'web_search', 'image_analysis']),
  complexity: z.enum(['low', 'medium', 'high']),
  needsRAG: z.boolean(),
  language: z.enum(['en', 'he', 'ar', 'mixed']),
  mainTopic: z.string().max(100),
  routeTo: z.enum([
    'gemini-3.1-pro', 'gemini-3-flash',
    'gpt-5.1', 'gpt-5-mini',
    'glm-5',
    'gemini-3.1-flash-image'
  ]),
  reasoning: z.string().max(200),
  // V4 additions
  workingMemoryPhase: z.enum(['planning', 'implementing', 'debugging', 'reviewing', 'none']).optional(),
  hasCodeMarkers: z.boolean().optional(),
  referencesDocument: z.boolean().optional(),
});

export type ClassificationResult = z.infer<typeof ClassificationSchema>;

function resolveModelFamily(userSelectedModel: string): 'gemini' | 'openai' | 'glm' {
  if (userSelectedModel.includes('gemini')) return 'gemini';
  if (userSelectedModel.includes('gpt') || userSelectedModel.includes('openai')) return 'openai';
  return 'glm';
}

function detectLanguageFast(text: string): 'en' | 'he' | 'ar' | 'mixed' {
  const hasHebrew = /[\u0590-\u05FF]/.test(text);
  const hasArabic = /[\u0600-\u06FF]/.test(text);
  const hasLatin = /[a-zA-Z]/.test(text);
  if (hasHebrew && (hasArabic || hasLatin)) return 'mixed';
  if (hasArabic && hasLatin) return 'mixed';
  if (hasHebrew) return 'he';
  if (hasArabic) return 'ar';
  return 'en';
}

const IMAGE_GEN_PATTERNS = [
  /\b(צור תמונה|צייר|תמונה של|generate image|create image|draw|paint|illustrate)\b/i,
  /\.(png|jpg|jpeg|svg|webp)\s*$/i,
  /\b(make me a|create a|design a)\s+(logo|icon|banner|thumbnail|poster|flyer)/i,
  /\b(לוגו|אייקון|באנר|פוסטר|תמונת פרופיל|קאבר)\b/i,
];

const WEB_SEARCH_PATTERNS = [
  /\b(מזג אווויר|weather)\b/i,
  /\b(חדשותות|news|מה קרה היום|what happened today)\b/i,
  /\b(שער דולר|שער יורו|price of|מחיר של)\b/i,
  /\b(today|now|current|latest|חי|עכשיו|היום|עדכני)\b.*\b(מחיר|price|שער|score|תוצאה|מצב|temperature|טמפרטורה)\b/i,
  /\b(מי ניצח|who won|what's the score|מה התוצאה)\b.*\b(today|היום|now|עכשיו|last night|אתמול)\b/i,
];

const CLASSIFIER_SYSTEM_PROMPT = `You are a router for a multi-model AI chat platform.
Your ONLY job: analyze the user message and return a single JSON object.

Return EXACTLY this JSON structure (no markdown, no explanation):
{
  "intent":"question|code|analysis|chitchat|creative|command|image_gen|web_search|image_analysis",
  "complexity":"low|medium|high",
  "needsRAG":true|false,
  "language":"en|he|ar|mixed",
  "mainTopic":"one short phrase",
  "routeTo":"gemini-3.1-pro|gemini-3-flash|gpt-5.1|gpt-5-mini|glm-5|gemini-3.1-flash-image",
  "reasoning":"one short sentence",
  "workingMemoryPhase":"planning|implementing|debugging|reviewing|none",
  "hasCodeMarkers":true|false,
  "referencesDocument":true|false
}

ROUTING ENGINE:
Step 1: CHECK HARD OVERRIDES
  IF image for analysis (hasImageInput=true) → routeTo: "gemini-3-flash", intent: "image_analysis", STOP
  IF generate/create image → routeTo: "gemini-3.1-flash-image", intent: "image_gen", STOP
  IF real-time data (weather, news, prices) → routeTo: "gemini-3-flash", intent: "web_search", STOP

Step 2: DETERMINE COMPLEXITY
  HIGH: multi-step reasoning, complex architecture, deep math proofs, explicit "deep/thorough"
  MEDIUM: single-step explanation, write a function, summarize
  LOW: simple factual, greeting, translation, yes/no
  DEFAULT: "medium"

Step 3: MAP TO MODEL (using userSelectedFamily)
  gemini + high → gemini-3.1-pro | medium/low → gemini-3-flash
  openai + high → gpt-5.1 | medium/low → gpt-5-mini
  glm → ALWAYS glm-5 (no sub-models)

Step 4: needsRAG
  TRUE if: high complexity, medium+code/analysis, references past conversation ("what did we discuss"), mentions uploaded doc
  FALSE if: chitchat, image_gen, web_search, low complexity, first message

Step 5: LANGUAGE
  Hebrew chars → "he" | Arabic chars → "ar" | Both + Latin → "mixed" | Only Latin → "en"

Step 6: TOPIC
  Max 5 words. "general chat" for chitchat. "unclear" if unknown.

Step 7: DETECT WORKING MEMORY PHASE
  planning — user is designing, brainstorming, choosing approach
  implementing — user is building, writing code, executing steps
  debugging — user has a broken thing and is fixing it
  reviewing — user is checking, testing, asking "is this correct"
  none — chitchat, simple Q&A, image gen, web search

Step 8: DETECT CODE MARKERS & DOCUMENT REFERENCES
  hasCodeMarkers: true if message contains code fences, function names, file extensions, or code keywords
  referencesDocument: true if message mentions "file", "document", "PDF", "upload"`;


export async function classifyIntent(
  message: string,
  userSelectedModel: string,
  hasImageAttachment: boolean = false
): Promise<ClassificationResult> {

  const backtick = String.fromCharCode(96);
  const codeMarkerPattern = backtick + backtick + backtick + '|[a-z_][a-z0-9_]*\\s*\\(|import\\s+|from\\s+[a-z]|\\.(ts|js|py|sql|tsx|jsx|css|html)\\b';
  const hasCodeMarkers = new RegExp(codeMarkerPattern, 'i').test(message);
  const referencesDocument = /\b(file|document|pdf|upload|attachment|קובץ|מסמך|בקובץ|במסמך)\b/i.test(message);

  if (hasImageAttachment) {
    return {
      intent: 'image_analysis', complexity: 'medium', needsRAG: false,
      language: detectLanguageFast(message), mainTopic: 'image analysis',
      routeTo: 'gemini-3-flash', reasoning: 'Image input detected, hard override to Gemini Flash',
      workingMemoryPhase: 'none', hasCodeMarkers, referencesDocument,
    };
  }

  if (IMAGE_GEN_PATTERNS.some(p => p.test(message))) {
    return {
      intent: 'image_gen', complexity: 'medium', needsRAG: false,
      language: detectLanguageFast(message), mainTopic: 'image generation',
      routeTo: 'gemini-3.1-flash-image', reasoning: 'Image generation request detected',
      workingMemoryPhase: 'none', hasCodeMarkers: false, referencesDocument: false,
    };
  }

  if (WEB_SEARCH_PATTERNS.some(p => p.test(message))) {
    return {
      intent: 'web_search', complexity: 'medium', needsRAG: false,
      language: detectLanguageFast(message), mainTopic: 'real-time information',
      routeTo: 'gemini-3-flash', reasoning: 'Real-time data needed',
      workingMemoryPhase: 'none', hasCodeMarkers, referencesDocument,
    };
  }

  const family = resolveModelFamily(userSelectedModel);

  try {
    const response = await fetch('https://open.bigmodel.cn/api/v4/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.GLM_API_KEY}` },
      body: JSON.stringify({
        model: 'glm-4-7b', max_tokens: 250, temperature: 0.05,
        messages: [
          { role: 'system', content: CLASSIFIER_SYSTEM_PROMPT },
          { role: 'user', content: `[userSelectedFamily: "${family}"]\n\n${message}` },
        ],
      }),
    });

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content || '';
    const cleaned = raw.replace(/```json?\s*/gi, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    const result = ClassificationSchema.parse(parsed);

    return validateRouting(result, family);
  } catch (error) {
    console.error('[Classifier] LLM failed:', error);
    return buildFallback(message, family);
  }
}

function validateRouting(result: ClassificationResult, family: 'gemini' | 'openai' | 'glm'): ClassificationResult {
  if (['image_gen', 'image_analysis', 'web_search'].includes(result.intent)) {
    const map: Record<string, string> = {
      image_gen: 'gemini-3.1-flash-image',
      image_analysis: 'gemini-3-flash',
      web_search: 'gemini-3-flash',
    };
    result.routeTo = map[result.intent] as any;
    return result;
  }

  const validRoutes: Record<string, string[]> = {
    gemini: ['gemini-3.1-pro', 'gemini-3-flash'],
    openai: ['gpt-5.1', 'gpt-5-mini'],
    glm: ['glm-5'],
  };

  const allowed = validRoutes[family];
  if (!allowed.includes(result.routeTo)) {
    if (family === 'glm') result.routeTo = 'glm-5';
    else if (result.complexity === 'high') result.routeTo = family === 'gemini' ? 'gemini-3.1-pro' : 'gpt-5.1';
    else result.routeTo = family === 'gemini' ? 'gemini-3-flash' : 'gpt-5-mini';
  }

  if (result.complexity === 'low' && ['gemini-3.1-pro', 'gpt-5.1'].includes(result.routeTo)) {
    result.routeTo = family === 'gemini' ? 'gemini-3-flash' : 'gpt-5-mini';
  }
  if (result.complexity === 'high' && ['gemini-3-flash', 'gpt-5-mini'].includes(result.routeTo) && family !== 'glm') {
    result.routeTo = family === 'gemini' ? 'gemini-3.1-pro' : 'gpt-5.1';
  }

  return result;
}

function buildFallback(message: string, family: 'gemini' | 'openai' | 'glm'): ClassificationResult {
  const lang = detectLanguageFast(message);
  const isSimple = message.trim().length < 15 ||
    /^(hi|hello|hey|תודה|תודה רבה|אוקיי|ok|בסדר|כן|לא|ביי|bye|thanks|thank you)$/i.test(message.trim());

  if (family === 'glm') {
    return { intent: isSimple ? 'chitchat' : 'question', complexity: isSimple ? 'low' : 'medium', needsRAG: !isSimple, language: lang, mainTopic: 'unclear', routeTo: 'glm-5', reasoning: 'Fallback for GLM' };
  }

  const cheapModel = family === 'gemini' ? 'gemini-3-flash' : 'gpt-5-mini';
  if (isSimple) {
    return { intent: 'chitchat', complexity: 'low', needsRAG: false, language: lang, mainTopic: 'general chat', routeTo: cheapModel, reasoning: 'Simple message fallback' };
  }

  return { intent: 'question', complexity: 'medium', needsRAG: true, language: lang, mainTopic: 'unclear', routeTo: cheapModel, reasoning: 'Uncertain query fallback with RAG' };
}