'use client';

import { Search, X } from 'lucide-react';
import { useSidebarStore } from '@/lib/store/sidebar-store';

export function SearchBar() {
  const { searchQuery, setSearchQuery } = useSidebarStore();

  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--muted-foreground)]" />
      <input
        type="text"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder="Search conversations..."
        className="w-full pl-8.5 pr-8 py-2 text-xs bg-[var(--secondary)] rounded-lg border border-transparent focus:border-[var(--border)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] transition-all duration-200"
      />
      {searchQuery && (
        <button
          onClick={() => setSearchQuery('')}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-[var(--accent)] transition-colors cursor-pointer"
        >
          <X className="w-3 h-3 text-[var(--muted-foreground)]" />
        </button>
      )}
    </div>
  );
}
