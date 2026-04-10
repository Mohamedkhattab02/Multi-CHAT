/**
 * Server-side text extraction from file data (base64).
 * Delegates to the Parallel Vision Extractor for all document types.
 * No truncation — full document content is returned.
 */

import { ultimateExtract, type StatusCallback } from '@/lib/processing/parallel-vision-extractor';

/**
 * Extract text from any supported file type.
 * Returns extracted text or empty string.
 *
 * @param onStatus - Optional callback for real-time progress (SSE status events)
 */
export async function extractTextFromFile(
  base64Data: string,
  mimeType: string,
  fileName: string,
  onStatus?: StatusCallback,
): Promise<string> {
  const result = await ultimateExtract(base64Data, mimeType, fileName, onStatus);
  return result.fullText;
}
