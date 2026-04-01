import * as Sentry from '@sentry/nextjs';

const isProduction = process.env.NODE_ENV === 'production';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Performance monitoring
  tracesSampleRate: 0.1,

  // Session replay — only in production to avoid script-tag React warnings in dev
  replaysSessionSampleRate: isProduction ? 0.05 : 0,
  replaysOnErrorSampleRate: isProduction ? 1.0 : 0,

  integrations: isProduction
    ? [
        Sentry.replayIntegration({
          maskAllText: true,
          blockAllMedia: false,
        }),
      ]
    : [],

  environment: process.env.NODE_ENV,
  enabled: isProduction,
});
