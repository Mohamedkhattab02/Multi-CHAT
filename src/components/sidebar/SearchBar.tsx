'use client';

import { Search } from 'lucide-react';
import { useSidebarStore } from '@/lib/store/sidebar-store';

export function SearchBar() {
  const { searchQuery, setSearchQuery } = useSidebarStore();

  return (
    <div className="relative">
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--muted-foreground)]" />
      <input
        type="text"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder="Search conversations..."
        className="w-full pl-8 pr-3 py-1.5 text-xs bg-[var(--secondary)] rounded-lg border-0 focus:outline-none focus:ring-1 focus:ring-[var(--ring)] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]"
      />
    </div>
  );
}
