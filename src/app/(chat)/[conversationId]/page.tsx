import { requireAuth } from '@/actions/auth';
import { getConversation, getConversationMessages } from '@/actions/conversations';
import { notFound } from 'next/navigation';
import { ChatArea } from '@/components/chat/ChatArea';

interface Props {
  params: Promise<{ conversationId: string }>;
}

export default async function ConversationPage({ params }: Props) {
  const { conversationId } = await params;
  const user = await requireAuth();

  const conversation = await getConversation(conversationId);
  if (!conversation) notFound();

  const messages = await getConversationMessages(conversationId);

  return (
    <ChatArea
      conversation={conversation}
      initialMessages={messages}
      userId={user.id}
    />
  );
}
