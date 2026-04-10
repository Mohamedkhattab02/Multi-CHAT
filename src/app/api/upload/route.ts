// ============================================================
// File Upload Endpoint (fast — storage only)
// POST /api/upload
// 1. Accepts a file via FormData (avoids Vercel 4.5MB JSON limit)
// 2. Uploads to Supabase Storage
// 3. Returns { url, storagePath } — text extraction happens in /api/chat
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import * as Sentry from '@sentry/nextjs';

export const runtime = 'nodejs';
export const maxDuration = 60; // Storage upload is fast

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

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

    // Text extraction is now handled server-side in /api/chat
    // to avoid blocking the client for 30-60s (Vision API is slow).
    // We only return storage metadata here for instant response.

    console.log(`[Upload] ${file.name}: ${file.size} bytes, uploaded to ${filePath}`);

    return NextResponse.json({
      url: urlData.publicUrl,
      storagePath: filePath,
      name: file.name,
      type: file.type,
      size: file.size,
    });
  } catch (err) {
    console.error('[Upload] Unexpected error:', err);
    Sentry.captureException(err, { tags: { action: 'file_upload' } });
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
