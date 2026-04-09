// ============================================================
// File Upload + Extract Endpoint
// POST /api/upload
// 1. Accepts a file via FormData (avoids Vercel 4.5MB JSON limit)
// 2. Uploads to Supabase Storage
// 3. Extracts text content (Vision, pdf-parse, docx, xlsx, pptx, etc.)
// 4. Returns { url, extractedText } — /api/chat uses extractedText directly
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { extractWithVision } from '@/lib/ai/vision-extract';
import * as Sentry from '@sentry/nextjs';
import pdfParse from 'pdf-parse-new';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes — Vision API on large PDFs can take 60-90s

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

// ── Text extraction helpers ──

async function extractPdfText(base64Data: string): Promise<string> {
  const buffer = Buffer.from(base64Data, 'base64');
  const originalWarn = console.warn;
  const originalInfo = console.info;
  const pdfNoisePattern = /TT:|getTextContent|fetchStandardFontData|standardFontDataUrl|page=\d+/;
  console.warn = (...args: unknown[]) => {
    if (pdfNoisePattern.test(String(args[0] || ''))) return;
    originalWarn.apply(console, args);
  };
  console.info = (...args: unknown[]) => {
    if (pdfNoisePattern.test(String(args[0] || ''))) return;
    originalInfo.apply(console, args);
  };
  try {
    const result = await pdfParse(buffer);
    return result.text.slice(0, 8000);
  } finally {
    console.warn = originalWarn;
    console.info = originalInfo;
  }
}

async function extractDocxText(base64Data: string): Promise<string> {
  const buffer = Buffer.from(base64Data, 'base64');
  const result = await mammoth.extractRawText({ buffer });
  return result.value.slice(0, 8000);
}

function extractSpreadsheetText(base64Data: string): string {
  const buffer = Buffer.from(base64Data, 'base64');
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const parts: string[] = [];
  for (const sheetName of workbook.SheetNames.slice(0, 5)) {
    const sheet = workbook.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(sheet);
    parts.push(`[Sheet: ${sheetName}]\n${csv}`);
  }
  return parts.join('\n\n').slice(0, 8000);
}

async function extractPptxText(base64Data: string): Promise<string> {
  const buffer = Buffer.from(base64Data, 'base64');
  const zip = await JSZip.loadAsync(buffer);
  const parts: string[] = [];
  const slideFiles = Object.keys(zip.files)
    .filter(name => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => {
      const numA = parseInt(a.match(/slide(\d+)/)?.[1] || '0');
      const numB = parseInt(b.match(/slide(\d+)/)?.[1] || '0');
      return numA - numB;
    });
  for (const slideName of slideFiles.slice(0, 50)) {
    const xml = await zip.files[slideName].async('text');
    const texts: string[] = [];
    const regex = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g;
    let match;
    while ((match = regex.exec(xml)) !== null) {
      const text = match[1].trim();
      if (text) texts.push(text);
    }
    if (texts.length > 0) {
      const slideNum = slideName.match(/slide(\d+)/)?.[1] || '?';
      parts.push(`[Slide ${slideNum}]\n${texts.join(' ')}`);
    }
  }
  return parts.join('\n\n').slice(0, 8000);
}

/**
 * Extract text from any supported file type.
 * Returns extracted text or empty string.
 */
async function extractTextFromFile(
  base64Data: string,
  mimeType: string,
  fileName: string
): Promise<string> {
  // PDF: Vision-first, fallback to pdf-parse
  if (mimeType === 'application/pdf') {
    try {
      const vision = await extractWithVision(base64Data, mimeType, fileName);
      let text = vision.text;

      if (!text || text.trim().length < 50) {
        console.log(`[Upload Extract] Vision returned little content for ${fileName}, falling back to pdf-parse`);
        const fallback = await extractPdfText(base64Data);
        if (fallback.trim().length > (text?.trim().length || 0)) {
          text = fallback;
        }
      }
      return text || '';
    } catch (err) {
      Sentry.captureException(err, { tags: { action: 'upload_pdf_extract' } });
      // Fallback to pdf-parse
      try {
        return await extractPdfText(base64Data);
      } catch {
        return '';
      }
    }
  }

  // DOCX / DOC
  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mimeType === 'application/msword'
  ) {
    try {
      return await extractDocxText(base64Data);
    } catch (err) {
      Sentry.captureException(err, { tags: { action: 'upload_docx_extract' } });
      return '';
    }
  }

  // Spreadsheets
  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mimeType === 'application/vnd.ms-excel' ||
    mimeType === 'text/csv'
  ) {
    try {
      if (mimeType === 'text/csv') {
        return Buffer.from(base64Data, 'base64').toString('utf-8').slice(0, 8000);
      }
      return extractSpreadsheetText(base64Data);
    } catch (err) {
      Sentry.captureException(err, { tags: { action: 'upload_sheet_extract' } });
      return '';
    }
  }

  // PPTX / PPT
  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    mimeType === 'application/vnd.ms-powerpoint'
  ) {
    try {
      return await extractPptxText(base64Data);
    } catch (err) {
      Sentry.captureException(err, { tags: { action: 'upload_pptx_extract' } });
      return '';
    }
  }

  // Plain text, JSON, XML, HTML, markdown, etc.
  if (mimeType.startsWith('text/') || mimeType === 'application/json' || mimeType === 'application/xml') {
    try {
      return Buffer.from(base64Data, 'base64').toString('utf-8').slice(0, 8000);
    } catch {
      return '';
    }
  }

  // Images — no text extraction here (handled by Gemini inline in chat)
  if (mimeType.startsWith('image/')) {
    return '';
  }

  // Catch-all: try to read as UTF-8
  try {
    const rawText = Buffer.from(base64Data, 'base64').toString('utf-8');
    const nonPrintableRatio = (rawText.match(/[\x00-\x08\x0E-\x1F]/g) || []).length / rawText.length;
    if (nonPrintableRatio < 0.1 && rawText.trim().length > 0) {
      return rawText.slice(0, 8000);
    }
  } catch {
    // ignore
  }
  return '';
}

// ── Main handler ──

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  let user = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch (err) {
    console.error('[Upload] Auth failed:', err);
  }
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'File too large (max 100MB)' }, { status: 413 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64Data = buffer.toString('base64');

    // Upload to Supabase Storage
    const serviceClient = createServiceClient();
    const safeName = (file.name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = `${user.id}/${Date.now()}_${safeName}`;

    const { error: uploadError } = await serviceClient.storage
      .from('attachments')
      .upload(filePath, buffer, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      console.error('[Upload] Storage error:', uploadError.message);
      Sentry.captureException(uploadError, { tags: { action: 'file_upload' } });
      return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
    }

    const { data: urlData } = serviceClient.storage
      .from('attachments')
      .getPublicUrl(filePath);

    // Extract text content from file (Vision API, pdf-parse, etc.)
    const extractedText = await extractTextFromFile(base64Data, file.type, file.name || 'file');

    console.log(`[Upload] ${file.name}: ${file.size} bytes, extracted ${extractedText.length} chars`);

    return NextResponse.json({
      url: urlData.publicUrl,
      storagePath: filePath,
      name: file.name,
      type: file.type,
      size: file.size,
      extractedText: extractedText || undefined,
    });
  } catch (err) {
    console.error('[Upload] Unexpected error:', err);
    Sentry.captureException(err, { tags: { action: 'file_upload' } });
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
