'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LogOut, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { HqSession, useHq } from '@/components/hq/hq-session';
import { ThemeToggle } from '@/components/hq/theme-toggle';
import { Pill } from '@/components/hq/ui';
import { LogoAuth } from '@/components/logo';
import { C, M } from '@/components/tokens';
import { hqSignOut } from '@/lib/hq-api';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const SIDEBAR_WIDTH = 220;
const NAV = [{ href: '/hq/accounts', label: 'Accounts', icon: Users }];

const pill: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  height: 38,
  padding: '0 12px',
  borderRadius: 8,
  border: `1px solid ${C.border2}`,
  background: C.white,
  color: C.text,
  fontFamily: 'inherit',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};

function Frame({ children }: { children: React.ReactNode }) {
  const { me } = useHq();
  const path = usePathname() ?? '';
  const isActive = (href: string) => path === href || path.startsWith(`${href}/`);
  const initial = (me.email ?? 'A').charAt(0).toUpperCase();
  const signOut = async () => {
    await hqSignOut();
    window.location.href = `${BASE}/login`;
  };

  return (
    <div
      className="hq-shell"
      style={{ display: 'flex', minHeight: '100dvh', background: 'var(--c-side-nav)' }}
    >
      <a
        href="#main"
        style={{ position: 'absolute', left: -9999, zIndex: 50 }}
        onFocus={(e) => {
          e.currentTarget.style.left = '8px';
        }}
        onBlur={(e) => {
          e.currentTarget.style.left = '-9999px';
        }}
      >
        Skip to content
      </a>

      <aside
        className="hidden md:flex"
        style={{
          width: SIDEBAR_WIDTH,
          minWidth: SIDEBAR_WIDTH,
          height: '100vh',
          position: 'sticky',
          top: 0,
          flexDirection: 'column',
          flexShrink: 0,
        }}
      >
        <div style={{ height: 70, display: 'flex', alignItems: 'center', paddingLeft: 20 }}>
          <Link
            href="/hq/accounts"
            aria-label="AiVastra team console home"
            style={{ display: 'flex' }}
          >
            <LogoAuth />
          </Link>
        </div>
        <div style={{ padding: '0 20px' }}>
          <span
            style={{
              display: 'inline-block',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 1,
              textTransform: 'uppercase',
              background: C.pink,
              color: '#fff',
              borderRadius: 6,
              padding: '3px 8px',
            }}
          >
            Team console
          </span>
        </div>
        <nav
          aria-label="Console"
          style={{ marginTop: 20, padding: '0 12px 16px 20px', display: 'grid', gap: 16 }}
        >
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = isActive(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className="mw-side-link"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  height: 40,
                  padding: 10,
                  borderRadius: 8,
                  textDecoration: 'none',
                  border: `1px solid ${active ? 'rgba(248, 248, 248, 0.1)' : 'transparent'}`,
                  backgroundColor: active ? 'rgba(248, 248, 248, 0.1)' : undefined,
                  fontSize: 14,
                  fontWeight: active ? 700 : 600,
                  color: active ? '#fafafa' : '#cdcdcd',
                }}
              >
                <Icon size={20} aria-hidden="true" strokeWidth={active ? 2 : 1.5} />
                {label}
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Phone width: the same bottom bar the retailer app uses. */}
      <nav
        aria-label="Console"
        className="fixed bottom-0 left-0 right-0 z-40 flex h-[var(--mw-nav-h)] justify-around md:hidden"
        style={{ background: C.navbar, borderTop: `1px solid ${C.border}` }}
      >
        {NAV.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={isActive(href) ? 'page' : undefined}
            className="flex min-w-[64px] flex-1 flex-col items-center gap-1 px-2 py-2 text-xs"
            style={{
              color: isActive(href) ? M.brand : C.mid,
              fontWeight: isActive(href) ? 700 : 500,
              textDecoration: 'none',
            }}
          >
            <Icon size={18} aria-hidden="true" />
            {label}
          </Link>
        ))}
      </nav>

      <main
        id="main"
        tabIndex={-1}
        className="flex min-w-0 flex-1 flex-col gap-4 p-4 pb-24 md:m-5 md:ml-0 md:rounded-[20px] md:p-5"
        style={{ background: C.bg, outline: 'none' }}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontWeight: 700,
                fontSize: 14,
                color: C.text,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {me.email}
            </div>
            <div style={{ marginTop: 2 }}>
              <Pill tone="muted">{me.role.replace('_', ' ').toLowerCase()}</Pill>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
            <ThemeToggle />
            <button type="button" onClick={() => void signOut()} style={pill}>
              <LogOut size={16} aria-hidden="true" />
              Sign out
            </button>
            <span
              aria-hidden="true"
              style={{
                width: 38,
                height: 38,
                borderRadius: '50%',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: M.brandTint,
                color: M.brand,
                fontWeight: 700,
                fontSize: 12,
              }}
            >
              {initial}
            </span>
          </div>
        </header>
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
