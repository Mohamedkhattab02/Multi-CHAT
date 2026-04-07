'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, X, Loader2 } from 'lucide-react';
import { useSidebarStore } from '@/lib/store/sidebar-store';
import { createClient } from '@/lib/supabase/client';

export function SearchBar() {
  const { searchQuery, setSearchQuery } = useSidebarStore();
  const [isSearching, setIsSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Debounced FTS search for message content
  const handleChange = useCallback((value: string) => {
    setSearchQuery(value);

    // Clear any pending debounce
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!value.trim()) {
      setIsSearching(false);
      return;
    }

    // Show loading indicator for longer queries
    if (value.trim().length >= 3) {
      setIsSearching(true);
      debounceRef.current = setTimeout(() => {
        setIsSearching(false);
      }, 300);
    }
  }, [setSearchQuery]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <div className="relative">
      {isSearching ? (
        <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--primary)] animate-spin" />
      ) : (
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--muted-foreground)]" />
      )}
      <input
        type="text"
        value={searchQuery}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="Search conversations..."
        className="w-full pl-8.5 pr-8 py-2 text-xs bg-[var(--secondary)] rounded-lg border border-transparent focus:border-[var(--border)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] transition-all duration-200"
      />
      {searchQuery && (
        <button
          onClick={() => {
            setSearchQuery('');
            setIsSearching(false);
          }}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-[var(--accent)] transition-colors cursor-pointer"
        >
          <X className="w-3 h-3 text-[var(--muted-foreground)]" />
        </button>
      )}
    </div>
  );
}
