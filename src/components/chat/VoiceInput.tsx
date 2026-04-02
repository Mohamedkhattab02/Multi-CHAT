'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Mic, MicOff } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

// ============================================================
// VoiceInput — Web Speech API (browser-native, FREE)
// Supports: English, Hebrew, Arabic
// ============================================================

interface ISpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onresult: ((event: any) => void) | null;
  onerror: ((event: Event & { error: string }) => void) | null;
  onend: (() => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition?: { new(): ISpeechRecognition };
    webkitSpeechRecognition?: { new(): ISpeechRecognition };
  }
}

interface VoiceInputProps {
  onTranscript: (text: string) => void;
  language?: string;
  disabled?: boolean;
}

export function VoiceInput({ onTranscript, language = 'auto', disabled }: VoiceInputProps) {
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const recognitionRef = useRef<ISpeechRecognition | null>(null);

  // Detect support on client only — avoids SSR hydration mismatch
  useEffect(() => {
    setIsSupported(!!window.SpeechRecognition || !!window.webkitSpeechRecognition);
  }, []);

  const getLang = (lang: string): string => {
    const map: Record<string, string> = {
      auto: 'en-US',
      en: 'en-US',
      he: 'he-IL',
      ar: 'ar-SA',
    };
    return map[lang] ?? 'en-US';
  };

  const startListening = useCallback(() => {
    if (!isSupported || disabled) return;

    const SpeechRecognitionClass = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SpeechRecognitionClass) return;

    const recognition = new SpeechRecognitionClass();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = getLang(language);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const transcript = Array.from(event.results as any[])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((r: any) => r[0].transcript)
        .join('');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((event.results[event.results.length - 1] as any).isFinal) {
        onTranscript(transcript);
      }
    };

    recognition.onerror = (event: Event & { error: string }) => {
      console.error('[VoiceInput] Error:', event.error);
      setIsListening(false);
    };

    recognition.onend = () => setIsListening(false);

    recognition.start();
    recognitionRef.current = recognition;
    setIsListening(true);
  }, [isSupported, disabled, language, onTranscript]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setIsListening(false);
  }, []);

  if (!isSupported) return null;

  return (
    <button
      type="button"
      onClick={isListening ? stopListening : startListening}
      disabled={disabled}
      title={isListening ? 'Stop recording' : 'Voice input'}
      className={cn(
        'p-2 rounded-lg transition-all',
        isListening
          ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400 animate-pulse'
          : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--secondary)]',
        disabled && 'opacity-40 cursor-not-allowed'
      )}
    >
      {isListening ? <MicOff size={18} /> : <Mic size={18} />}
    </button>
  );
}
