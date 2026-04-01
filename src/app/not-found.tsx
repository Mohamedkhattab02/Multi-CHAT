import Link from 'next/link';
import { MessageSquare } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-8 text-center bg-[var(--background)]">
      <div className="w-14 h-14 rounded-xl bg-[var(--primary)]/10 flex items-center justify-center mb-5">
        <MessageSquare className="w-7 h-7 text-[var(--primary)]" />
      </div>
      <h1 className="text-4xl font-bold text-[var(--foreground)] mb-2">404</h1>
      <p className="text-lg font-medium text-[var(--foreground)] mb-1">Page not found</p>
      <p className="text-sm text-[var(--muted-foreground)] mb-6 max-w-sm">
        The page you&apos;re looking for doesn&apos;t exist or has been moved.
      </p>
      <Link
        href="/chat"
        className="inline-flex items-center gap-2 px-4 py-2 bg-[var(--primary)] text-[var(--primary-foreground)] rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
      >
        Go to chat
      </Link>
    </div>
  );
}
