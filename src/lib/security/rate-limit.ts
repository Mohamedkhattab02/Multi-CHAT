import arcjet, { tokenBucket, shield, detectBot } from '@arcjet/next';

// ============================================================
// Arcjet Rate Limiting + Bot Protection
// ============================================================

// Main chat endpoint — strict limits
export const chatRateLimit = arcjet({
  key: process.env.ARCJET_KEY!,
  rules: [
    // Shield against common attacks
    shield({ mode: 'LIVE' }),
    // Block bots (except search engines)
    detectBot({
      mode: 'LIVE',
      allow: ['CATEGORY:SEARCH_ENGINE'],
    }),
    // Token bucket: 20 requests per minute per user
    tokenBucket({
      mode: 'LIVE',
      characteristics: ['userId'],
      refillRate: 20,
      interval: 60,
      capacity: 20,
    }),
  ],
});

// Upload endpoint — stricter limits
export const uploadRateLimit = arcjet({
  key: process.env.ARCJET_KEY!,
  rules: [
    shield({ mode: 'LIVE' }),
    detectBot({ mode: 'LIVE', allow: [] }),
    tokenBucket({
      mode: 'LIVE',
      characteristics: ['userId'],
      refillRate: 10,
      interval: 60,
      capacity: 10,
    }),
  ],
});

// Auth endpoints — very strict
export const authRateLimit = arcjet({
  key: process.env.ARCJET_KEY!,
  rules: [
    shield({ mode: 'LIVE' }),
    detectBot({ mode: 'LIVE', allow: [] }),
    tokenBucket({
      mode: 'LIVE',
      characteristics: ['ip.src'],
      refillRate: 5,
      interval: 60,
      capacity: 5,
    }),
  ],
});

// General API endpoints
export const apiRateLimit = arcjet({
  key: process.env.ARCJET_KEY!,
  rules: [
    shield({ mode: 'LIVE' }),
    tokenBucket({
      mode: 'LIVE',
      characteristics: ['userId'],
      refillRate: 60,
      interval: 60,
      capacity: 100,
    }),
  ],
});
