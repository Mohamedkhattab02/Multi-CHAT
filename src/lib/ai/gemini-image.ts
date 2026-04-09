// ============================================================
// Gemini 3.1 Flash Image Preview — Image Generation at 1K res
// Triggered when classifier detects image generation intent
// ============================================================

import { GoogleGenerativeAI } from '@google/generative-ai';
import * as Sentry from '@sentry/nextjs';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY!);

export interface ImageGenerationResult {
  imageBase64: string;
  mimeType: string;
  revisedPrompt: string;
}

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1500;

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function generateImage(prompt: string): Promise<ImageGenerationResult> {
  const model = genAI.getGenerativeModel({
    model: 'gemini-3.1-flash-image-preview',
    generationConfig: {
      // @ts-expect-error -- responseModalities not yet in SDK types
      responseModalities: ['image', 'text'],
    },
  });

  // Enhance prompt for 1K resolution output
  const enhancedPrompt = `${prompt}\n\nGenerate this image in high quality, 1024x1024 resolution.`;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`[ImageGen] Retry attempt ${attempt}/${MAX_RETRIES}`);
        await sleep(RETRY_DELAY_MS * attempt);
      }

      const result = await model.generateContent(enhancedPrompt);
      const response = result.response;
      const parts = response.candidates?.[0]?.content?.parts;

      if (!parts || parts.length === 0) {
        throw new Error('No response parts from Gemini Image model');
      }

      // Find image and text parts
      let imageBase64 = '';
      let mimeType = 'image/png';
      let revisedPrompt = prompt;

      for (const part of parts) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const p = part as any;
        if (p.inlineData) {
          imageBase64 = p.inlineData.data;
          mimeType = p.inlineData.mimeType || 'image/png';
        }
        if (p.text) {
          revisedPrompt = p.text;
        }
      }

      if (!imageBase64) {
        throw new Error('Model returned response but no image data was included');
      }

      return { imageBase64, mimeType, revisedPrompt };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const errorMessage = lastError.message.toLowerCase();

      // Don't retry on safety blocks or invalid prompts
      if (
        errorMessage.includes('safety') ||
        errorMessage.includes('blocked') ||
        errorMessage.includes('harm') ||
        errorMessage.includes('invalid')
      ) {
        console.error(`[ImageGen] Non-retryable error: ${lastError.message}`);
        break;
      }

      console.error(`[ImageGen] Attempt ${attempt + 1} failed: ${lastError.message}`);
    }
  }

  Sentry.captureException(lastError, {
    tags: { model: 'gemini-3.1-flash-image-preview', action: 'generate_image' },
  });
  throw lastError;
}
