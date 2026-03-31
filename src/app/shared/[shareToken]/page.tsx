import { createClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import { formatDate, formatTime } from '@/lib/utils/format';

interface Props {
  params: Promise<{ shareToken: string }>;
}

const MODEL_COLORS: Record<string, string> = {
  'gpt-5.1': '#10B981',
  'gpt-5-mini': '#10B981',
  'gemini-3.1-pro': '#3B82F6',
  'gemini-3-flash': '#3B82F6',
  'glm-5': '#7C3AED',
};

export default async function SharedConversationPage({ params }: Props) {
  const { shareToken } = await params;
  const supabase = await createClient();

  const { data: conversation } = await supabase
    .from('conversations')
    .select('*')
    .eq('share_token', shareToken)
    .eq('is_public', true)
    .single();

  if (!conversation) notFound();

  const { data: messages } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversation.id)
    .order('created_at', { ascending: true });

  return (
    <div className="min-h-screen bg-[var(--background)]">
      {/* Header */}
      <div className="border-b border-[var(--border)] px-4 py-3 flex items-center gap-3">
        <span className="font-semibold text-sm text-[var(--foreground)]">MultiChat AI</span>
        <span className="text-[var(--muted-foreground)] text-xs">·</span>
        <span className="text-sm text-[var(--foreground)] truncate">{conversation.title}</span>
        <span
          className="ml-auto text-xs px-2 py-0.5 rounded-full text-white flex-shrink-0"
          style={{ backgroundColor: MODEL_COLORS[conversation.model] ?? '#737373' }}
        >
          {conversation.model}
        </span>
      </div>

      {/* Messages */}
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        {(messages ?? []).map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm ${
                msg.role === 'user'
                  ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
                  : 'bg-[var(--secondary)] text-[var(--foreground)]'
              }`}
            >
              <p>{msg.content}</p>
              <p className="text-[10px] mt-1 opacity-60">
                {formatDate(msg.created_at)} {formatTime(msg.created_at)}
              </p>
            </div>
          </div>
        ))}
      </div>

      <div className="text-center py-6 text-xs text-[var(--muted-foreground)]">
        Shared via MultiChat AI — read-only view
      </div>
    </div>
  );
}
