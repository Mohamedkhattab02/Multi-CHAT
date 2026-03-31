'use client';

import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { LogOut, Sun, Moon } from 'lucide-react';
import { useTheme } from 'next-themes';

export function UserMenu() {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const supabase = createClient();

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  return (
    <div className="flex items-center gap-1 p-2">
      <button
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        className="flex-1 flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[var(--secondary)] transition-colors text-xs text-[var(--muted-foreground)]"
      >
        {theme === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
        {theme === 'dark' ? 'Light mode' : 'Dark mode'}
      </button>
      <button
        onClick={handleSignOut}
        className="p-1.5 rounded-lg hover:bg-[var(--secondary)] transition-colors"
        title="Sign out"
      >
        <LogOut className="w-3.5 h-3.5 text-[var(--muted-foreground)]" />
      </button>
    </div>
  );
}
