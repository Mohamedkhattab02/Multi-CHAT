'use server';

import { createClient } from '@/lib/supabase/server';
import { requireAuth } from './auth';
import type { Message } from '@/lib/supabase/types';

export async function getMessages(conversationId: string): Promise<Message[]> {
  await requireAuth();
  const supabase = await createClient();

  const { data } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  return data ?? [];
}

export async function deleteMessage(messageId: string): Promise<boolean> {
  const user = await requireAuth();
  const supabase = await createClient();

  // Verify ownership through conversation
  const { data: message } = await supabase
    .from('messages')
    .select('id, conversation_id')
    .eq('id', messageId)
    .single();

  if (!message) return false;

  const { data: conversation } = await supabase
    .from('conversations')
    .select('user_id')
    .eq('id', message.conversation_id)
    .single();

  if (conversation?.user_id !== user.id) return false;

  const { error } = await supabase
    .from('messages')
    .delete()
    .eq('id', messageId);

  return !error;
}
