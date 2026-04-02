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

export async function generateImage(prompt: string): Promise<ImageGenerationResult> {
  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-3.1-flash-image-preview',
      generationConfig: {
        // @ts-expect-error -- responseModalities not yet in SDK types
        responseModalities: ['image', 'text'],
      },
    });

    const result = await model.generateContent(prompt);
    const response = result.response;
    const parts = response.candidates?.[0]?.content?.parts;

    if (!parts) {
      throw new Error('No response parts from Gemini Image');
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
      throw new Error('No image generated in response');
    }

    return { imageBase64, mimeType, revisedPrompt };
  } catch (error) {
    Sentry.captureException(error, {
      tags: { model: 'gemini-3.1-flash-image-preview', action: 'generate_image' },
    });
    throw error;
  }
}
