'use client';

import { useQuery } from '@tanstack/react-query';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect } from 'react';
import { api } from '@/lib/api';

interface MeResponse {
  phone: string | null;
  companyName: string | null;
}

export function ProfileGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { data, isLoading } = useQuery<MeResponse>({
    queryKey: ['me'],
    queryFn: () => api.get('/v1/me'),
    retry: false,
  });

  const complete =
    Boolean(data?.phone && /^\d{10}$/.test(data.phone)) && Boolean(data?.companyName?.trim());
  const onSettings = pathname === '/settings' || pathname.startsWith('/settings/');

  useEffect(() => {
    if (!isLoading && data && !complete && !onSettings) {
      router.replace('/settings');
    }
  }, [complete, data, isLoading, onSettings, router]);

  if (isLoading || (data && !complete && !onSettings)) {
    return <div style={{ flex: 1, background: '#fff' }} />;
  }

  return children;
}
