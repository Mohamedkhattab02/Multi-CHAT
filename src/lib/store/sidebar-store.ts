import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SidebarStore {
  isOpen: boolean;
  searchQuery: string;
  activeFolder: string | null;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  setSearchQuery: (query: string) => void;
  setActiveFolder: (id: string | null) => void;
}

export const useSidebarStore = create<SidebarStore>()(
  persist(
    (set) => ({
      isOpen: true,
      searchQuery: '',
      activeFolder: null,
      setOpen: (open) => set({ isOpen: open }),
      toggle: () => set((s) => ({ isOpen: !s.isOpen })),
      setSearchQuery: (query) => set({ searchQuery: query }),
      setActiveFolder: (id) => set({ activeFolder: id }),
    }),
    {
      name: 'sidebar-store',
      partialize: (s) => ({ isOpen: s.isOpen, activeFolder: s.activeFolder }),
    }
  )
);
