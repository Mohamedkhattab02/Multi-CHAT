import * as Sentry from '@sentry/nextjs';

export async function generateImage(prompt: string): Promise<{
  imageBase64: string;
  mimeType: string;
  revisedPrompt: string;
}> {
  try {
    const apiKey = process.env.GOOGLE_AI_API_KEY;
    const modelId = 'gemini-3.1-flash-image-preview';
    const baseUrl = 'https://generativelanguage.googleapis.com/v1beta/models';

    const res = await fetch(`${baseUrl}/${modelId}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ['image', 'text'],
        },
      }),
    });

    if (!res.ok) {
      throw new Error(`Gemini Image API error: ${res.status}`);
    }

    const data = await res.json();
    const imagePart = data.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);

    if (!imagePart?.inlineData) {
      throw new Error('No image generated');
    }

    const textPart = data.candidates?.[0]?.content?.parts?.find((p: any) => p.text);

    return {
      imageBase64: imagePart.inlineData.data,
      mimeType: imagePart.inlineData.mimeType || 'image/png',
      revisedPrompt: textPart?.text || prompt,
    };
  } catch (error) {
    Sentry.captureException(error, { tags: { model: 'gemini-flash-image' } });
    throw error;
  }
}