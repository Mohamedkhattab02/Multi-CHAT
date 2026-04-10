import { create } from 'zustand';

const MIN_WIDTH = 300;
const MAX_WIDTH = 900;
const DEFAULT_WIDTH = 500;

interface CodePanelStore {
  isOpen: boolean;
  code: string;
  language: string;
  title: string;
  width: number;

  openPanel: (code: string, language: string, title?: string) => void;
  closePanel: () => void;
  setWidth: (width: number) => void;
}

export const useCodePanelStore = create<CodePanelStore>((set) => ({
  isOpen: false,
  code: '',
  language: '',
  title: '',
  width: DEFAULT_WIDTH,

  openPanel: (code, language, title) =>
    set({ isOpen: true, code, language, title: title || language || 'Code' }),
  closePanel: () => set({ isOpen: false }),
  setWidth: (width) => set({ width: Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, width)) }),
}));

export { MIN_WIDTH, MAX_WIDTH };
