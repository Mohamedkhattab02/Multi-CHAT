import { create } from 'zustand';

interface UiStore {
  isMobile: boolean;
  isCommandPaletteOpen: boolean;
  isShareDialogOpen: boolean;
  shareConversationId: string | null;

  setMobile: (mobile: boolean) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setShareDialogOpen: (open: boolean, conversationId?: string) => void;
}

export const useUiStore = create<UiStore>((set) => ({
  isMobile: false,
  isCommandPaletteOpen: false,
  isShareDialogOpen: false,
  shareConversationId: null,

  setMobile: (mobile) => set({ isMobile: mobile }),
  setCommandPaletteOpen: (open) => set({ isCommandPaletteOpen: open }),
  setShareDialogOpen: (open, conversationId) =>
    set({ isShareDialogOpen: open, shareConversationId: conversationId ?? null }),
}));
