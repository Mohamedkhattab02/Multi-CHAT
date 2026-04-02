'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getMessages, deleteMessage } from '@/actions/messages';
import type { Message } from '@/lib/supabase/types';

export function useMessages(conversationId: string | null) {
  const queryClient = useQueryClient();
  const queryKey = ['messages', conversationId];

  const {
    data: messages = [],
    isLoading,
    error,
  } = useQuery({
    queryKey,
    queryFn: () => (conversationId ? getMessages(conversationId) : []),
    enabled: !!conversationId,
    staleTime: 30_000,
  });

  // Optimistically add messages to the list (after streaming completes)
  const addMessages = (newMessages: Message[]) => {
    queryClient.setQueryData<Message[]>(queryKey, (old = []) => {
      // Avoid duplicates by checking IDs
      const existingIds = new Set(old.map((m) => m.id));
      const unique = newMessages.filter((m) => !existingIds.has(m.id));
      return [...old, ...unique];
    });
  };

  const deleteMutation = useMutation({
    mutationFn: (messageId: string) => deleteMessage(messageId),
    onMutate: async (messageId) => {
      // Optimistic removal
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<Message[]>(queryKey);
      queryClient.setQueryData<Message[]>(queryKey, (old = []) =>
        old.filter((m) => m.id !== messageId)
      );
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKey, context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  // Refetch messages from DB (e.g., after streaming to get real IDs)
  const refetch = () => {
    queryClient.invalidateQueries({ queryKey });
  };

  return {
    messages,
    isLoading,
    error,
    addMessages,
    deleteMessage: deleteMutation.mutate,
    refetch,
  };
}
