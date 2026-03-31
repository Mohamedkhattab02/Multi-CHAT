// ============================================================
// Helicone AI Observability proxy configuration
// Route AI API calls through Helicone for cost/latency tracking
// ============================================================

export const HELICONE_OPENAI_BASE_URL = 'https://oai.helicone.ai/v1';
export const HELICONE_GOOGLE_BASE_URL = 'https://gateway.helicone.ai';

export function getHeliconeHeaders(userId?: string, conversationId?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Helicone-Auth': `Bearer ${process.env.HELICONE_API_KEY}`,
    'Helicone-Property-App': 'multichat-ai',
  };

  if (userId) {
    headers['Helicone-User-Id'] = userId;
  }
  if (conversationId) {
    headers['Helicone-Property-ConversationId'] = conversationId;
  }

  return headers;
}

// OpenAI client config with Helicone proxy
export function getOpenAIConfig(userId?: string, conversationId?: string) {
  return {
    baseURL: HELICONE_OPENAI_BASE_URL,
    defaultHeaders: getHeliconeHeaders(userId, conversationId),
  };
}
