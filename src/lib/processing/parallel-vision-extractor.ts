// ============================================================
// Parallel Vision Extractor — Ultimate Document Processing
// Handles ALL document types with maximum accuracy & speed:
//   PDF:   Split into 3-page chunks → parallel Vision API calls
//   DOCX:  Native text (mammoth) + Vision on embedded images
//   PPTX:  Native text (JSZip XML) + Vision on embedded media
//   Excel: Native text (xlsx)
//   CSV:   Raw UTF-8
//   Other: UTF-8 fallback
//
// Key principles:
//   - NO text truncation (no .slice(0, 8000))
//   - Controlled parallelism (max 5 concurrent Vision requests)
//   - Real-time status callbacks for SSE streaming
//   - Graceful fallback when Vision fails
// ============================================================

import { PDFDocument } from 'pdf-lib';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import * as Sentry from '@sentry/nextjs';

// Fast & cheap Vision model for extraction
const VISION_MODEL = 'gemini-2.5-flash-lite';

// Max concurrent Vision API requests (prevents rate limiting)
const MAX_CONCURRENT = 5;

// Pages per chunk — optimal balance between speed and cost
const CHUNK_SIZE = 5;

export interface ExtractResult {
  fullText: string;
  method: 'parallel_vision' | 'native_text' | 'vision_text_fallback' | 'native_plus_vision';
  pageCount?: number;
}

export type StatusCallback = (status: string, detail?: string) => void;

/**
 * Main entry point — extracts text from any supported document type.
 * No truncation. Full content. Maximum accuracy.
 */
export async function ultimateExtract(
  base64Data: string,
  mimeType: string,
  fileName: string,
  onStatus?: StatusCallback,
): Promise<ExtractResult> {
  // PDF → Parallel Chunked Vision (the magic)
  if (mimeType === 'application/pdf') {
    return extractPdfParallelVision(base64Data, fileName, onStatus);
  }

  // DOCX → Native text + Vision on embedded images
  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mimeType === 'application/msword' ||
    mimeType.includes('word') ||
    mimeType.includes('document')
  ) {
    return extractDocxNativePlusImages(base64Data, fileName, onStatus);
  }

  // PPTX → Native text + Vision on embedded media
  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    mimeType === 'application/vnd.ms-powerpoint' ||
    mimeType.includes('presentation')
  ) {
    return extractPptxNativePlusMedia(base64Data, fileName, onStatus);
  }

  // Excel / CSV → Native text only
  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mimeType === 'application/vnd.ms-excel' ||
    mimeType.includes('sheet') ||
    mimeType.includes('excel') ||
    mimeType === 'text/csv'
  ) {
    onStatus?.('extracting_document', fileName);
    return { fullText: extractSpreadsheet(base64Data, mimeType), method: 'native_text' };
  }

  // Plain text, JSON, XML, HTML, markdown
  if (mimeType.startsWith('text/') || mimeType === 'application/json' || mimeType === 'application/xml') {
    return { fullText: Buffer.from(base64Data, 'base64').toString('utf-8'), method: 'native_text' };
  }

  // Images — no text extraction (handled inline by Gemini in chat)
  if (mimeType.startsWith('image/')) {
    return { fullText: '', method: 'native_text' };
  }

  // Catch-all: try UTF-8
  try {
    const rawText = Buffer.from(base64Data, 'base64').toString('utf-8');
    const nonPrintableRatio = (rawText.match(/[\x00-\x08\x0E-\x1F]/g) || []).length / rawText.length;
    if (nonPrintableRatio < 0.1 && rawText.trim().length > 0) {
      return { fullText: rawText, method: 'native_text' };
    }
  } catch {
    // ignore
  }
  return { fullText: '', method: 'native_text' };
}


// ============================================================
// 1. PDF: Split → Parallel Vision (the real magic)
// ============================================================

async function extractPdfParallelVision(
  base64Data: string,
  fileName: string,
  onStatus?: StatusCallback,
): Promise<ExtractResult> {
  try {
    const buffer = Buffer.from(base64Data, 'base64');
    const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const totalPages = pdfDoc.getPageCount();

    onStatus?.('extracting_pages', `0/${totalPages}`);
    console.log(`[ParallelVision] ${fileName}: ${totalPages} pages, splitting into ${Math.ceil(totalPages / CHUNK_SIZE)} chunks`);

    // 1. Split PDF into small chunks (pure JS, very fast)
    const chunks: { base64: string; startPage: number; endPage: number }[] = [];
    for (let i = 0; i < totalPages; i += CHUNK_SIZE) {
      const newDoc = await PDFDocument.create();
      const end = Math.min(i + CHUNK_SIZE, totalPages);
      const indices = Array.from({ length: end - i }, (_, k) => i + k);
      const pages = await newDoc.copyPages(pdfDoc, indices);
      pages.forEach(p => newDoc.addPage(p));
      const pdfBytes = await newDoc.save();
      chunks.push({
        base64: Buffer.from(pdfBytes).toString('base64'),
        startPage: i + 1,
        endPage: end,
      });
    }

    // 2. Send all chunks to Vision in controlled waves
    let completedPages = 0;
    const results: string[] = new Array(chunks.length);

    for (let wave = 0; wave < chunks.length; wave += MAX_CONCURRENT) {
      const waveChunks = chunks.slice(wave, wave + MAX_CONCURRENT);
      const wavePromises = waveChunks.map(async (chunk, waveIdx) => {
        const globalIdx = wave + waveIdx;
        const text = await extractChunkWithVision(chunk.base64, chunk.startPage);
        results[globalIdx] = text;
        completedPages += (chunk.endPage - chunk.startPage + 1);
        onStatus?.('extracting_pages', `${completedPages}/${totalPages}`);
      });

      await Promise.all(wavePromises);
    }

    // 3. Assemble full text
    const fullText = results.join('\n\n');

    // 4. Fallback: if Vision returned too little, fall back to pdf-parse
    if (fullText.trim().length < 100) {
      console.warn(`[ParallelVision] ${fileName}: Vision returned too little text (${fullText.trim().length} chars), falling back to pdf-parse`);
      onStatus?.('extracting_document', `${fileName} (fallback)`);
      const { default: pdfParse } = await import('pdf-parse-new');
      const text = (await pdfParse(buffer)).text;
      return { fullText: text, method: 'vision_text_fallback', pageCount: totalPages };
    }

    console.log(`[ParallelVision] ${fileName}: Done — ${fullText.length} chars from ${totalPages} pages`);
    return { fullText, method: 'parallel_vision', pageCount: totalPages };
  } catch (error) {
    console.error(`[ParallelVision] ${fileName}: Failed, falling back to pdf-parse`, error);
    Sentry.captureException(error, { tags: { action: 'parallel_vision' }, extra: { fileName } });
    // If pdf-lib fails (corrupted file), fall back to text extraction
    try {
      const { default: pdfParse } = await import('pdf-parse-new');
      const text = (await pdfParse(Buffer.from(base64Data, 'base64'))).text;
      return { fullText: text, method: 'vision_text_fallback' };
    } catch {
      return { fullText: '', method: 'vision_text_fallback' };
    }
  }
}

/**
 * Send a single PDF chunk (up to CHUNK_SIZE pages) to Gemini Vision.
 * Uses raw fetch for full control over the request.
 */
async function extractChunkWithVision(chunkBase64: string, startPage: number): Promise<string> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_AI_API_KEY not set');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${VISION_MODEL}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          {
            inlineData: { mimeType: 'application/pdf', data: chunkBase64 },
          },
          {
            text: `Extract EVERYTHING from these pages.
1. Transcribe all text exactly as written (maintain original language).
2. If there are tables, recreate them as Markdown tables.
3. If there are diagrams, flowcharts, or images: DO NOT ignore them. Describe their structure, labels, arrows, and data in detail.
4. Format output with page separators like: "--- Page X ---"
Start from Page ${startPage}.`,
          },
        ],
      }],
      generationConfig: {
        maxOutputTokens: 4096,
        temperature: 0,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Vision API error ${response.status}: ${errorText.slice(0, 200)}`);
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}


// ============================================================
// 2. DOCX: Native text + Vision on embedded images
// ============================================================

async function extractDocxNativePlusImages(
  base64Data: string,
  fileName: string,
  onStatus?: StatusCallback,
): Promise<ExtractResult> {
  onStatus?.('extracting_document', fileName);
  const buffer = Buffer.from(base64Data, 'base64');

  // Extract text with mammoth
  const textResult = await mammoth.extractRawText({ buffer });
  let fullText = `[Document: ${fileName}]\n\n${textResult.value}`;

  // Extract embedded images from the DOCX ZIP
  try {
    const zip = await JSZip.loadAsync(buffer);
    const imageFiles = Object.keys(zip.files).filter(name =>
      name.startsWith('word/media/') && /\.(png|jpg|jpeg|gif|bmp|tiff)$/i.test(name)
    );

    if (imageFiles.length > 0 && imageFiles.length <= 30) {
      console.log(`[DocExtract] ${fileName}: Found ${imageFiles.length} embedded images`);
      onStatus?.('analyzing_images', `0/${imageFiles.length}`);

      let completedImages = 0;
      const imageDescriptions: string[] = [];

      // Process images in controlled waves
      for (let wave = 0; wave < imageFiles.length; wave += MAX_CONCURRENT) {
        const waveFiles = imageFiles.slice(wave, wave + MAX_CONCURRENT);
        const wavePromises = waveFiles.map(async (imgPath) => {
          try {
            const imgBase64 = await zip.files[imgPath].async('base64');
            const ext = imgPath.split('.').pop()?.toLowerCase() || 'png';
            const imgMimeType = ext === 'png' ? 'image/png' : 'image/jpeg';
            const description = await describeImage(imgBase64, imgMimeType);
            return `[Embedded Image: ${imgPath.split('/').pop()}]\n${description}`;
          } catch {
            return null;
          } finally {
            completedImages++;
            onStatus?.('analyzing_images', `${completedImages}/${imageFiles.length}`);
          }
        });

        const results = (await Promise.all(wavePromises)).filter(Boolean) as string[];
        imageDescriptions.push(...results);
      }

      if (imageDescriptions.length > 0) {
        fullText += `\n\n--- Embedded Images ---\n${imageDescriptions.join('\n\n')}`;
      }

      return { fullText, method: 'native_plus_vision' };
    }
  } catch (err) {
    // If ZIP parsing fails for images, we still have the text
    console.warn(`[DocExtract] ${fileName}: Could not extract images`, err);
  }

  return { fullText, method: 'native_text' };
}


// ============================================================
// 3. PPTX: Native text + Vision on embedded media
// ============================================================

async function extractPptxNativePlusMedia(
  base64Data: string,
  fileName: string,
  onStatus?: StatusCallback,
): Promise<ExtractResult> {
  onStatus?.('extracting_document', fileName);
  const zip = await JSZip.loadAsync(Buffer.from(base64Data, 'base64'));

  // Find and sort slides
  const slideFiles = Object.keys(zip.files)
    .filter(name => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) =>
      parseInt(a.match(/\d+/)?.[0] || '0') - parseInt(b.match(/\d+/)?.[0] || '0')
    );

  let fullText = `[Presentation: ${fileName}]\n`;

  // Extract text from each slide
  for (const slideName of slideFiles) {
    const xml = await zip.files[slideName].async('text');
    const texts: string[] = [];
    const regex = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g;
    let match;
    while ((match = regex.exec(xml)) !== null) {
      if (match[1].trim()) texts.push(match[1].trim());
    }

    const slideNum = slideName.match(/\d+/)?.[0] || '?';
    fullText += `\n--- Slide ${slideNum} ---\n${texts.join(' ') || '[Visual Slide - No Text]'}`;
  }

  // Extract embedded media (images, diagrams)
  const mediaFiles = Object.keys(zip.files).filter(name =>
    /^ppt\/media\//i.test(name) && /\.(png|jpg|jpeg|gif)$/i.test(name)
  );

  if (mediaFiles.length > 0 && mediaFiles.length <= 30) {
    console.log(`[PptxExtract] ${fileName}: Processing ${mediaFiles.length} media files`);
    onStatus?.('analyzing_images', `0/${mediaFiles.length}`);

    let completedMedia = 0;
    const mediaDescriptions: string[] = [];

    for (let wave = 0; wave < mediaFiles.length; wave += MAX_CONCURRENT) {
      const waveFiles = mediaFiles.slice(wave, wave + MAX_CONCURRENT);
      const wavePromises = waveFiles.map(async (imgPath) => {
        try {
          const imgBase64 = await zip.files[imgPath].async('base64');
          const ext = imgPath.split('.').pop()?.toLowerCase() || 'png';
          const imgMimeType = ext === 'png' ? 'image/png' : 'image/jpeg';
          const description = await describeImage(imgBase64, imgMimeType);
          return `[Media: ${imgPath.split('/').pop()}]\n${description}`;
        } catch {
          return null;
        } finally {
          completedMedia++;
          onStatus?.('analyzing_images', `${completedMedia}/${mediaFiles.length}`);
        }
      });

      const results = (await Promise.all(wavePromises)).filter(Boolean) as string[];
      mediaDescriptions.push(...results);
    }

    if (mediaDescriptions.length > 0) {
      fullText += `\n\n--- Embedded Media ---\n${mediaDescriptions.join('\n\n')}`;
    }

    return { fullText, method: 'native_plus_vision' };
  }

  return { fullText, method: 'native_text' };
}


// ============================================================
// 4. Spreadsheets
// ============================================================

function extractSpreadsheet(base64Data: string, mimeType: string): string {
  const buffer = Buffer.from(base64Data, 'base64');

  if (mimeType === 'text/csv') {
    return buffer.toString('utf-8');
  }

  const workbook = XLSX.read(buffer, { type: 'buffer' });
  return workbook.SheetNames.slice(0, 5).map(name =>
    `[Sheet: ${name}]\n${XLSX.utils.sheet_to_csv(workbook.Sheets[name])}`
  ).join('\n\n');
}


// ============================================================
// 5. Vision helper — describe a single image (for DOCX/PPTX)
// ============================================================

async function describeImage(base64Data: string, mimeType: string): Promise<string> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) return '[Could not analyze — API key not set]';

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${VISION_MODEL}:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { inlineData: { mimeType, data: base64Data } },
          {
            text: 'Describe this image in extreme detail. If it\'s a chart/diagram, explain the data, axes, and labels. Respond in the language of the content.',
          },
        ],
      }],
      generationConfig: {
        maxOutputTokens: 2048,
        temperature: 0,
      },
    }),
  });

  if (!res.ok) return '[Could not analyze]';
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '[Could not analyze]';
}
