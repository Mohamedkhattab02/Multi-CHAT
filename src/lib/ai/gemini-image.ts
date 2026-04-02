import { GoogleGenerativeAI } from '@google/generative-ai';

// ============================================================
// Gemini 3.1 Flash Image Preview — image generation at 1K res
// Returns a data URL of the generated image
// ============================================================

const IMAGE_MODEL = 'gemini-2.0-flash-preview-image-generation';

export interface ImageGenerationResult {
  imageUrl: string;       // base64 data URL
  mimeType: string;
  textResponse?: string;  // any accompanying text
}

export async function generateImage(params: {
  prompt: string;
  onChunk?: (text: string) => void;
}): Promise<ImageGenerationResult> {
  const { prompt, onChunk } = params;

  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY ?? '');

  const model = genAI.getGenerativeModel({
    model: IMAGE_MODEL,
    generationConfig: {
      // @ts-expect-error — responseModalities is a newer API field
      responseModalities: ['Text', 'Image'],
    },
  });

  const result = await model.generateContent(prompt);
  const response = result.response;

  let imageUrl = '';
  let mimeType = 'image/png';
  let textResponse = '';

  for (const part of response.candidates?.[0]?.content?.parts ?? []) {
    if ('text' in part && part.text) {
      textResponse = part.text;
      if (onChunk) onChunk(part.text);
    }
    if ('inlineData' in part && part.inlineData) {
      mimeType = part.inlineData.mimeType ?? 'image/png';
      imageUrl = `data:${mimeType};base64,${part.inlineData.data}`;
    }
  }

  if (!imageUrl) {
    throw new Error('No image generated — Gemini returned no inline image data');
  }

  return { imageUrl, mimeType, textResponse };
}
