// ============================================================
// Vision-Based Document Extraction — Gemini Vision API
// Sends raw PDF/image bytes to Gemini which "sees" each page.
// Captures text, images, diagrams, tables, handwriting.
// Returns rich markdown text ready for chunking.
// ============================================================

import { GoogleGenerativeAI } from '@google/generative-ai';
import * as Sentry from '@sentry/nextjs';

const VISION_MODEL = 'gemini-2.5-flash';

// MIME types that Gemini can process visually
const GEMINI_NATIVE_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

const EXTRACTION_PROMPT = `You are a document content extractor. Analyze EVERY page of this document visually and extract ALL content.

RULES:
1. Extract ALL text exactly as it appears — preserve formatting, headings, bullet points
2. For IMAGES, DIAGRAMS, CHARTS, FIGURES: describe them in detail inside [IMAGE: ...] tags
   Example: [IMAGE: Bar chart showing sales growth from 2020-2024, with Q4 2024 reaching $4.2M]
3. For TABLES: reproduce them as markdown tables with all data
4. For HANDWRITTEN text: transcribe it and mark as [HANDWRITTEN: ...]
5. For EQUATIONS/FORMULAS: write them in plain text or LaTeX notation
6. Preserve the page order — add "--- Page X ---" separators between pages
7. Do NOT summarize. Do NOT skip content. Extract EVERYTHING you can see.
8. If a page has both text and images, extract both in reading order.
9. For languages other than English (Hebrew, Arabic, etc.) — extract in the original language.

Output: Complete extracted content in markdown format.`;

/**
 * Returns true if this MIME type can be processed by Gemini Vision.
 */
export function isVisionSupported(mimeType: string): boolean {
  return GEMINI_NATIVE_TYPES.has(mimeType);
}

/**
 * Extract document content using Gemini Vision API.
 * Only call this for supported types (use isVisionSupported to check).
 */
export async function extractWithVision(
  base64Data: string,
  mimeType: string,
  fileName: string
): Promise<{ text: string; pageCount: number }> {
  if (!GEMINI_NATIVE_TYPES.has(mimeType)) {
    return { text: '', pageCount: 0 };
  }

  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    console.error('[VisionExtract] GOOGLE_AI_API_KEY not set');
    return { text: '', pageCount: 0 };
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: VISION_MODEL,
      generationConfig: {
        maxOutputTokens: 16384,
        temperature: 0,
      },
    });

    const result = await model.generateContent([
      { text: `${EXTRACTION_PROMPT}\n\nFile: ${fileName}` },
      {
        inlineData: {
          mimeType,
          data: base64Data,
        },
      },
    ]);

    const text = result.response.text();
    const pageCount = (text.match(/--- Page \d+ ---/g) || []).length || 1;

    console.log(`[VisionExtract] ${fileName}: ${text.length} chars, ${pageCount} pages`);
    return { text, pageCount };
  } catch (error) {
    Sentry.captureException(error, {
      tags: { action: 'vision_extract' },
      extra: { fileName, mimeType },
    });
    console.error(`[VisionExtract] Failed for ${fileName}:`, error);
    return { text: '', pageCount: 0 };
  }
}
