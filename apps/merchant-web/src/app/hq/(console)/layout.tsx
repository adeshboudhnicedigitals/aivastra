'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { HqSession, useHq } from '@/components/hq/hq-session';
import { C } from '@/components/tokens';
import { hqSignOut } from '@/lib/hq-api';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

function Frame({ children }: { children: React.ReactNode }) {
  const { me } = useHq();
  return (
    <div style={{ minHeight: '100vh', background: C.bg }}>
      {/* A different bar from the retailer app, so nobody mistakes which one they are in. */}
      <header
        style={{
          background: '#1f1147',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '0 16px',
          height: 52,
        }}
      >
        <strong style={{ fontSize: 15 }}>AiVastra team console</strong>
        <nav aria-label="Console" style={{ display: 'flex', gap: 12, flex: 1 }}>
          <Link href="/hq/accounts" style={{ color: '#fff', fontSize: 14, fontWeight: 600 }}>
            Accounts
          </Link>
        </nav>
        <span style={{ fontSize: 12, opacity: 0.8 }}>
          {me.email} ({me.role})
        </span>
        <button
          type="button"
          onClick={async () => {
            await hqSignOut();
            window.location.href = `${BASE}/login`;
          }}
          style={{
            background: 'transparent',
            color: '#fff',
            border: '1px solid rgba(255,255,255,0.5)',
            borderRadius: 8,
            height: 32,
            padding: '0 12px',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          Sign out
        </button>
      </header>
      <main id="main" tabIndex={-1} style={{ padding: 16, maxWidth: 1200, margin: '0 auto' }}>
        {children}
      </main>
    </div>
  );
}

export default function HqLayout({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <HqSession>
        <Frame>{children}</Frame>
      </HqSession>
    </QueryClientProvider>
  );
}
