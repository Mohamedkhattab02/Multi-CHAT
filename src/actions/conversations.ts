'use server';

import { createClient } from '@/lib/supabase/server';
import { requireAuth } from './auth';
import type { Conversation, Message } from '@/lib/supabase/types';

export async function getConversation(conversationId: string): Promise<Conversation | null> {
  const user = await requireAuth();
  const supabase = await createClient();

  const { data } = await supabase
    .from('conversations')
    .select('id, user_id, title, model, summary, system_prompt, topic, message_count, is_pinned, share_token, is_public, folder_id, created_at, updated_at')
    .eq('id', conversationId)
    .eq('user_id', user.id)
    .single();

  return data;
}

export async function getConversationMessages(conversationId: string): Promise<Message[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  return data ?? [];
}

export async function getSharedConversation(shareToken: string) {
  const supabase = await createClient();

  const { data: conversation } = await supabase
    .from('conversations')
    .select('id, user_id, title, model, summary, system_prompt, topic, message_count, is_pinned, share_token, is_public, folder_id, created_at, updated_at')
    .eq('share_token', shareToken)
    .eq('is_public', true)
    .single();

  if (!conversation) return null;

  const { data: messages } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversation.id)
    .order('created_at', { ascending: true });

  return { conversation, messages: messages ?? [] };
}
