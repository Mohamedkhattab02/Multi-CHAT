import { z } from 'zod';

// ============================================================
// ZOD SCHEMAS — Runtime validation for all API inputs
// ============================================================

export const ChatMessageSchema = z.object({
  conversationId: z.string().uuid().optional(),
  message: z.string().min(1).max(50000),
  model: z.enum(['gpt-5.1', 'gpt-5-mini', 'gemini-3.1-pro', 'gemini-3-flash', 'gemini-3.1-flash-image', 'glm-5']),
  attachments: z
    .array(
      z.object({
        url: z.string().url(),
        type: z.enum(['image', 'pdf', 'document']),
        name: z.string().max(255),
        size: z.number().max(10 * 1024 * 1024), // 10MB max
      })
    )
    .max(5)
    .optional()
    .default([]),
});

export const CreateConversationSchema = z.object({
  title: z.string().min(1).max(200).optional().default('New conversation'),
  model: z.enum(['gpt-5.1', 'gpt-5-mini', 'gemini-3.1-pro', 'gemini-3-flash', 'gemini-3.1-flash-image', 'glm-5']),
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

export const UploadSchema = z.object({
  fileName: z.string().max(255),
  fileType: z.enum(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf', 'text/plain', 'text/markdown']),
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
