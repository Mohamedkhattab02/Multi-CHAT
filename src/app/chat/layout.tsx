import { requireAuth } from '@/actions/auth';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { ErrorBoundary } from '@/components/layout/ErrorBoundary';

export default async function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireAuth();

  return (
    <div className="flex h-full overflow-hidden bg-[var(--background)]">
      <ErrorBoundary>
        <Sidebar userId={user.id} />
      </ErrorBoundary>

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <ErrorBoundary>{children}</ErrorBoundary>
      </main>
    </div>
  );
}
