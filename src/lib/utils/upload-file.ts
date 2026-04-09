/**
 * Upload a file to Supabase Storage via /api/upload (FormData).
 * Returns the storage URL and base64 data for processing.
 * This avoids the Vercel 4.5MB JSON body limit on /api/chat.
 */

export interface UploadedFile {
  url: string;
  storagePath: string;
  name: string;
  type: string;
  size: number;
  extractedText?: string;
}

export async function uploadFile(file: File): Promise<UploadedFile> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch('/api/upload', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Upload failed: ${response.status}`);
  }

  return response.json();
}
