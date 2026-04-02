'use server';

import { createClient } from '@/lib/supabase/server';
import { requireAuth } from './auth';

// ============================================================
// messages.ts — Server Actions for message CRUD
// ============================================================

export async function getMessages(conversationId: string) {
  const user = await requireAuth();
  const supabase = await createClient();

  // Verify conversation belongs to user
  const { data: conv } = await supabase
    .from('conversations')
    .select('id')
    .eq('id', conversationId)
    .eq('user_id', user.id)
    .single();

  if (!conv) return { messages: [], error: 'Conversation not found' };

  const { data: messages, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  return { messages: messages ?? [], error: error?.message };
}

export async function deleteMessage(messageId: string) {
  const user = await requireAuth();
  const supabase = await createClient();

  // Verify message belongs to user (via conversation)
  const { data: message } = await supabase
    .from('messages')
    .select('conversation_id')
    .eq('id', messageId)
    .single();

  if (!message) return { error: 'Message not found' };

  const { data: conv } = await supabase
    .from('conversations')
    .select('id')
    .eq('id', message.conversation_id)
    .eq('user_id', user.id)
    .single();

  if (!conv) return { error: 'Not authorized' };

  const { error } = await supabase
    .from('messages')
    .delete()
    .eq('id', messageId);

  return { error: error?.message };
}

export async function regenerateMessage(
  messageId: string
): Promise<{ lastUserMessage: string | null; conversationId: string | null }> {
  const user = await requireAuth();
  const supabase = await createClient();

  // Get the message to regenerate
  const { data: message } = await supabase
    .from('messages')
    .select('conversation_id, created_at')
    .eq('id', messageId)
    .single();

  if (!message) return { lastUserMessage: null, conversationId: null };

  // Verify ownership
  const { data: conv } = await supabase
    .from('conversations')
    .select('id')
    .eq('id', message.conversation_id)
    .eq('user_id', user.id)
    .single();

  if (!conv) return { lastUserMessage: null, conversationId: null };

  // Delete this assistant message
  await supabase.from('messages').delete().eq('id', messageId);

  // Get the last user message before this one
  const { data: prevMessages } = await supabase
    .from('messages')
    .select('content, role')
    .eq('conversation_id', message.conversation_id)
    .lt('created_at', message.created_at)
    .order('created_at', { ascending: false })
    .limit(5);

  const lastUserMessage =
    prevMessages?.find((m: { role: string; content: string }) => m.role === 'user')?.content ?? null;

  return { lastUserMessage, conversationId: message.conversation_id };
}
