'use client';

import { useEffect } from 'react';
import { useChatStore } from '@/lib/store/chat-store';
import { MODELS, type ModelId } from '@/lib/utils/constants';

const PROVIDER_THEME_MAP: Record<string, string> = {
  google: 'theme-gemini',
  openai: 'theme-gpt',
  zhipu: 'theme-glm',
};

const ALL_THEME_CLASSES = Object.values(PROVIDER_THEME_MAP);

/**
 * Watches the selected model in the chat store and applies
 * the corresponding theme class to <html>, making the entire
 * UI adopt the look of the selected AI provider.
 */
export function ModelThemeSync() {
  const selectedModel = useChatStore((s) => s.selectedModel);

  useEffect(() => {
    const provider = MODELS[selectedModel as ModelId]?.provider;
    const themeClass = provider ? PROVIDER_THEME_MAP[provider] : undefined;

    const html = document.documentElement;

    // Remove all model theme classes
    ALL_THEME_CLASSES.forEach((cls) => html.classList.remove(cls));

    // Apply the new one
    if (themeClass) {
      html.classList.add(themeClass);
    }

    return () => {
      // Cleanup on unmount
      ALL_THEME_CLASSES.forEach((cls) => html.classList.remove(cls));
    };
  }, [selectedModel]);

  return null;
}
