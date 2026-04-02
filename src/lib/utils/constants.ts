// ============================================================
// Model configurations, limits, prices
// ============================================================

export const MODELS = {
  'gpt-5.1': {
    name: 'GPT 5.1',
    shortName: 'ChatGPT',
    provider: 'openai',
    color: '#10B981',
    contextWindow: 128000,
    outputLimit: 16384,
    costPerMInput: 15, // USD per 1M tokens (estimate)
    costPerMOutput: 60,
  },
  'gpt-5-mini': {
    name: 'GPT 5 Mini',
    shortName: 'GPT Mini',
    provider: 'openai',
    color: '#10B981',
    contextWindow: 128000,
    outputLimit: 16384,
    costPerMInput: 0.15,
    costPerMOutput: 0.6,
  },
  'gemini-3.1-pro': {
    name: 'Gemini 3.1 Pro',
    shortName: 'Gemini',
    provider: 'google',
    color: '#3B82F6',
    contextWindow: 1000000,
    outputLimit: 8192,
    costPerMInput: 1.25,
    costPerMOutput: 5,
  },
  'gemini-3-flash': {
    name: 'Gemini 3 Flash',
    shortName: 'Gemini Flash',
    provider: 'google',
    color: '#3B82F6',
    contextWindow: 1000000,
    outputLimit: 8192,
    costPerMInput: 0.075,
    costPerMOutput: 0.3,
  },
  'gemini-3.1-flash-image': {
    name: 'Gemini 3.1 Flash Image',
    shortName: 'Gemini Image',
    provider: 'google',
    color: '#3B82F6',
    contextWindow: 32000,
    outputLimit: 8192,
    costPerMInput: 0.075,
    costPerMOutput: 0.3,
  },
  'glm-4.7': {
    name: 'GLM 4.7',
    shortName: 'GLM',
    provider: 'zhipu',
    color: '#7C3AED',
    contextWindow: 128000,
    outputLimit: 8192,
    costPerMInput: 0.5,
    costPerMOutput: 0.5,
  },
  'glm-4.6': {
    name: 'GLM 4.6',
    shortName: 'GLM 4.6',
    provider: 'zhipu',
    color: '#7C3AED',
    contextWindow: 128000,
    outputLimit: 4096,
    costPerMInput: 0.1,
    costPerMOutput: 0.1,
  },
} as const;

export type ModelId = keyof typeof MODELS;

export const USER_SELECTABLE_MODELS: ModelId[] = [
  'gpt-5.1',
  'gemini-3.1-pro',
  'glm-4.7',
];

export const DEFAULT_MODEL: ModelId = 'gemini-3.1-pro';

export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
export const MAX_ATTACHMENTS = 5;
export const DAILY_MESSAGE_LIMIT = 100;

export const TOKEN_BUDGETS = {
  'gpt-5.1':       { system: 2000, rag: 4000, history: 6000, output: 4000 },
  'gpt-5-mini':    { system: 1000, rag: 2000, history: 4000, output: 2000 },
  'gemini-3.1-pro':{ system: 2000, rag: 8000, history: 16000, output: 8000 },
  'gemini-3-flash':{ system: 1000, rag: 4000, history: 8000, output: 4000 },
  'gemini-3.1-flash-image': { system: 1000, rag: 2000, history: 4000, output: 2000 },
  'glm-4.7':       { system: 2000, rag: 4000, history: 8000, output: 4000 },
  'glm-4.6':       { system: 1000, rag: 2000, history: 4000, output: 2000 },
} as const;
