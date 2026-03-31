import { createClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import { ChatArea } from '@/components/chat/ChatArea';

interface Props {
  params: Promise<{ conversationId: string }>;
}

export default async function ConversationPage({ params }: Props) {
  const { conversationId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: conversation } = await supabase
    .from('conversations')
    .select('*')
    .eq('id', conversationId)
    .eq('user_id', user.id)
    .single();

  if (!conversation) {
    notFound();
  }

  const { data: messages } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  return (
    <ChatArea
      conversation={conversation}
      initialMessages={messages ?? []}
      userId={user.id}
    />
  );
}
