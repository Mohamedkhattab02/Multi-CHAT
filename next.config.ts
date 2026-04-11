import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

const nextConfig: NextConfig = {
  reactCompiler: true,

  // Allow cross-origin requests from any source in dev (iframe previews, etc.)
  allowedDevOrigins: ['localhost', '127.0.0.1', '0.0.0.0'],

  // pdf-parse-new uses dynamic requires that break webpack bundling
  serverExternalPackages: ['pdf-parse-new'],

  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.supabase.co' },
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
    ],
  },

  // Allow server actions from any origin in dev
  experimental: {
    serverActions: {
      allowedOrigins: ['localhost:3000'],
    },
  },
};

export default withSentryConfig(nextConfig, {
  // Sentry webpack plugin options
  silent: true,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  widenClientFileUpload: true,
  disableLogger: true,
  // Disable auto-injected script tags that cause React warnings
  autoInstrumentServerFunctions: false,
  autoInstrumentMiddleware: false,
});
