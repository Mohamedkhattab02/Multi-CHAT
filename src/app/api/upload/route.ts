// ============================================================
// File Upload Endpoint — Upload to Supabase Storage
// POST /api/upload
// Accepts FormData with a single file, uploads to Supabase Storage,
// returns the public URL + base64 data for server-side processing.
// This avoids the Vercel 4.5MB JSON body limit on /api/chat.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import * as Sentry from '@sentry/nextjs';

export const runtime = 'nodejs';

// Allow up to 100MB uploads (matching client-side MAX_FILE_SIZE)
export const maxDuration = 60;

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

export async function POST(req: NextRequest) {
  // Auth check
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

    // Read file into buffer
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

    // Return only URL + storagePath — NO base64 in the response
    // The /api/chat route will download from storage when it needs the data
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
