'use client';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { LogoAuth } from '@/components/logo';
import { C } from '@/components/tokens';

const AUTH_PATHS = ['/merchant/login', '/merchant/signup'];

export default function MerchantLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  if (AUTH_PATHS.includes(pathname)) return <>{children}</>;

  async function handleLogout() {
    await fetch('/api/merchant/logout', { method: 'POST' });
    router.push('/merchant/login');
  }

  return (
    <div style={{ minHeight: '100vh', background: C.bg }}>
      <nav
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 32px',
          height: 64,
          background: C.card,
          borderBottom: `1px solid ${C.border}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <LogoAuth />
          <span style={{ fontSize: 13, color: C.mid, fontWeight: 500 }}>Merchant Portal</span>
        </div>
        <button
          onClick={handleLogout}
          style={{
            background: 'none',
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            padding: '6px 16px',
            fontSize: 13,
            color: C.text,
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontWeight: 500,
          }}
        >
          Logout
        </button>
      </nav>
      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 24px' }}>{children}</main>
    </div>
  );
}
