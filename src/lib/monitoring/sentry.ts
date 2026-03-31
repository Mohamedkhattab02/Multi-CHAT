import * as Sentry from '@sentry/nextjs';

// ============================================================
// Sentry helpers
// ============================================================

export function captureAIError(
  error: unknown,
  context: {
    model: string;
    action: string;
    userId?: string;
    conversationId?: string;
  }
) {
  Sentry.captureException(error, {
    tags: {
      model: context.model,
      action: context.action,
    },
    user: context.userId ? { id: context.userId } : undefined,
    extra: {
      conversationId: context.conversationId,
    },
  });
}

export function captureApiError(
  error: unknown,
  context: {
    endpoint: string;
    userId?: string;
    method?: string;
  }
) {
  Sentry.captureException(error, {
    tags: {
      endpoint: context.endpoint,
      method: context.method,
    },
    user: context.userId ? { id: context.userId } : undefined,
  });
}

export function setUserContext(userId: string, email?: string) {
  Sentry.setUser({ id: userId, email });
}

export function clearUserContext() {
  Sentry.setUser(null);
}

export { Sentry };
