'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { SessionProvider, useSession } from '@/components/session-provider';
import { Shell } from '@/components/shell';
import { C } from '@/components/tokens';
import { ToastProvider } from '@/components/ui/toast';

function Gate({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (status === 'signed-out') router.replace('/login');
  }, [status, router]);

  if (status !== 'ready') {
    return (
      <div role="status" style={{ padding: 24, color: C.mid, fontSize: 14 }}>
        Loading...
      </div>
    );
  }
  return <Shell>{children}</Shell>;
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <ToastProvider>
          <Gate>{children}</Gate>
        </ToastProvider>
      </SessionProvider>
    </QueryClientProvider>
  );
}
