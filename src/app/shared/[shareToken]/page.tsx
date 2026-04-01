import { getSharedConversation } from '@/actions/conversations';
import { notFound } from 'next/navigation';
import { SharedConversationView } from '@/components/chat/SharedConversationView';

interface Props {
  params: Promise<{ shareToken: string }>;
}

export default async function SharedConversationPage({ params }: Props) {
  const { shareToken } = await params;
  const result = await getSharedConversation(shareToken);
  if (!result) notFound();

  return (
    <SharedConversationView
      conversation={result.conversation}
      messages={result.messages}
    />
  );
}
