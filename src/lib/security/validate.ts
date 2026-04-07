import { z } from 'zod';

// ============================================================
// ZOD SCHEMAS — Runtime validation for all API inputs
// ============================================================

export const ChatMessageSchema = z.object({
  conversationId: z.string().uuid().optional(),
  message: z.string().min(0).max(50000),
  model: z.enum(['gpt-5.1', 'gpt-5-mini', 'gemini-3.1-pro', 'gemini-3-flash', 'gemini-3.1-flash-image', 'glm-4.7', 'glm-4.6']),
  attachments: z
    .array(
      z.object({
        type: z.string().max(100),
        name: z.string().max(255),
        size: z.number().max(10 * 1024 * 1024), // 10MB max
        url: z.string().url().optional(),
        data: z.string().optional(), // base64 for images
      })
    )
    .max(5)
    .optional()
    .default([]),
});

export const CreateConversationSchema = z.object({
  title: z.string().min(1).max(200).optional().default('New conversation'),
  model: z.enum(['gpt-5.1', 'gpt-5-mini', 'gemini-3.1-pro', 'gemini-3-flash', 'gemini-3.1-flash-image', 'glm-4.7', 'glm-4.6']),
  folderId: z.string().uuid().optional(),
});

export const UpdateConversationSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(200).optional(),
  isPinned: z.boolean().optional(),
  folderId: z.string().uuid().nullable().optional(),
  systemPrompt: z.string().max(5000).optional(),
});

export const DeleteConversationSchema = z.object({
  id: z.string().uuid(),
});

// All supported MIME types for file uploads
export const SUPPORTED_FILE_TYPES = [
  // Images
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/bmp',
  // Documents
  'application/pdf',
  'text/plain', 'text/markdown', 'text/csv', 'text/html', 'text/xml',
  // Office documents
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',       // .xlsx
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
  'application/msword',           // .doc
  'application/vnd.ms-excel',     // .xls
  'application/vnd.ms-powerpoint', // .ppt
  'application/rtf',
  // Data formats
  'application/json', 'application/xml',
  // Archives
  'application/zip', 'application/x-zip-compressed',
] as const;

export const UploadSchema = z.object({
  fileName: z.string().max(255),
  fileType: z.string().max(200),
  fileSize: z.number().max(10 * 1024 * 1024),
});

export const ShareSchema = z.object({
  conversationId: z.string().uuid(),
  action: z.enum(['generate', 'revoke']),
});

export const MemoriesSchema = z.object({
  query: z.string().min(1).max(1000),
  topK: z.number().int().min(1).max(20).optional().default(5),
});

export const ExportPdfSchema = z.object({
  conversationId: z.string().uuid(),
});

export type ChatMessageInput = z.infer<typeof ChatMessageSchema>;
export type CreateConversationInput = z.infer<typeof CreateConversationSchema>;
export type UpdateConversationInput = z.infer<typeof UpdateConversationSchema>;
export type UploadInput = z.infer<typeof UploadSchema>;
export type ShareInput = z.infer<typeof ShareSchema>;
export type MemoriesInput = z.infer<typeof MemoriesSchema>;
