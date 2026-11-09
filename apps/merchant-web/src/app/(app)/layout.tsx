'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { JobStreamProvider } from '@/components/job-stream-provider';
import { SessionProvider, useSession } from '@/components/session-provider';
import { Shell } from '@/components/shell';
import { C } from '@/components/tokens';

function Gate({ children }: { children: React.ReactNode }) {
  const { status, reason } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (status === 'signed-out') router.replace(reason ? `/login?error=${reason}` : '/login');
  }, [status, reason, router]);

  if (status !== 'ready') {
    return (
      <div role="status" style={{ padding: 24, color: C.mid, fontSize: 14 }}>
        Loading...
      </div>
    );
  }
  // Inside the ready gate so no SSE connection opens on /login or while signed out.
  return (
    <JobStreamProvider>
      <Shell>{children}</Shell>
    </JobStreamProvider>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <Gate>{children}</Gate>
      </SessionProvider>
    </QueryClientProvider>
  );
}
