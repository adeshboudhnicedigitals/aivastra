'use client';

import { Shirt } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { MoonIcon, SunIcon } from '@/components/icons';
import { SupportButton } from '@/components/SupportModal';

const AUTH_PATHS = ['/merchant/login', '/merchant/signup'];
const W = 240;

// ── Icons ────────────────────────────────────────────────────────────────────
const Ic = {
  dashboard: (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <rect x="1" y="1" width="6" height="6" rx="1.5" />
      <rect x="9" y="1" width="6" height="6" rx="1.5" />
      <rect x="1" y="9" width="6" height="6" rx="1.5" />
      <rect x="9" y="9" width="6" height="6" rx="1.5" />
    </svg>
  ),
  key: (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12.65 10A6 6 0 1 0 10 12.65L16.65 19.3l1.41-1.41-1.35-1.35 1.35-1.36-1.41-1.41-1.35 1.36-1.29-1.29A5.97 5.97 0 0 0 12.65 10zM6 10a4 4 0 1 1 8 0 4 4 0 0 1-8 0z" />
    </svg>
  ),
  results: (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z" />
    </svg>
  ),
  settings: (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a6.04 6.04 0 0 0-1.62-.94l-.36-2.54A.484.484 0 0 0 15.93 4h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.48.48 0 0 0-.59.22L4.74 10.27a.47.47 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.47.47 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.47.47 0 0 0-.12-.61l-2.01-1.58zM12 15.6a3.6 3.6 0 1 1 0-7.2 3.6 3.6 0 0 1 0 7.2z" />
    </svg>
  ),
  docs: (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm4 18H6V4h7v5h5v11z" />
    </svg>
  ),
  pricing: (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20 4H4c-1.11 0-2 .89-2 2v12c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z" />
    </svg>
  ),
  logout: (
    <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4C2.9 3 2 3.9 2 5v14c0 1.1.9 2 2 2h8v-2H4V5z" />
    </svg>
  ),
  search: (
    <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
      <path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
    </svg>
  ),
  chevron: (
    <svg
      aria-hidden="true"
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <path d="M1.5 3.5L5 7L8.5 3.5" />
    </svg>
  ),
  profile: (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z" />
    </svg>
  ),
};

const NAV = [
  {
    section: 'Core Services',
    items: [
      { label: 'Dashboard', href: '/merchant/dashboard', icon: Ic.dashboard },
      { label: 'API Keys', href: '/merchant/api-keys', icon: Ic.key },
    ],
  },
  {
    section: 'Management',
    items: [
      { label: 'Try-On Results', href: '/merchant/tryon-results', icon: Ic.results },
      { label: 'Settings', href: '/merchant/settings', icon: Ic.settings },
      { label: 'Documentation', href: '/merchant/documentation', icon: Ic.docs },
    ],
  },
  {
    section: 'Account',
    items: [{ label: 'Credit Pricing Plans', href: '/merchant/pricing', icon: Ic.pricing }],
  },
];

// ── Theme toggle ────────────────────────────────────────────────────────────
function ThemeToggle() {
  const [dark, setDark] = useState(() =>
    typeof document !== 'undefined' ? document.documentElement.classList.contains('dark') : false,
  );

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('theme', next ? 'dark' : 'light');
  }

  return (
    <button
      type="button"
      onClick={toggle}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 34,
        height: 34,
        borderRadius: 8,
        border: '1px solid var(--c-merchant-border-light)',
        background: 'var(--c-white)',
        cursor: 'pointer',
        color: 'var(--c-merchant-text-secondary)',
      }}
      title={dark ? 'Switch to light' : 'Switch to dark'}
    >
      {dark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

// ── Admin dropdown ────────────────────────────────────────────────────────────
function AdminDropdown() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    fetch('/api/merchant/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { contactName?: string } | null) => {
        if (d?.contactName) setName(d.contactName);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const initial = (name || 'M').charAt(0).toUpperCase();
  const displayName = name || 'Account';

  async function logout() {
    await fetch('/api/merchant/logout', { method: 'POST' });
    router.push('/merchant/login');
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 12px 6px 6px',
          borderRadius: 10,
          border: '1px solid var(--c-merchant-border-light)',
          background: 'var(--c-white)',
          cursor: 'pointer',
          fontFamily: 'inherit',
          fontSize: 13,
          fontWeight: 500,
          color: 'var(--c-merchant-text-secondary)',
          boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: 'linear-gradient(135deg,#7c5cfc,#c44dfa)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--c-white)',
            fontSize: 12,
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          {initial}
        </div>
        {displayName}
        {Ic.chevron}
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 8px)',
            background: 'var(--c-white)',
            border: '1px solid var(--c-merchant-border-light)',
            borderRadius: 12,
            boxShadow: '0 8px 32px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.04)',
            minWidth: 190,
            zIndex: 200,
            overflow: 'hidden',
          }}
        >
          {[
            { label: 'Update Profile', href: '/merchant/profile', icon: Ic.profile },
            { label: 'Settings', href: '/merchant/settings', icon: Ic.settings },
          ].map(({ label, href, icon }) => (
            <Link
              key={label}
              href={href}
              onClick={() => setOpen(false)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '11px 16px',
                fontSize: 13,
                color: 'var(--c-merchant-text-secondary)',
                textDecoration: 'none',
              }}
            >
              <span style={{ color: 'var(--c-merchant-text-placeholder)' }}>{icon}</span>
              {label}
            </Link>
          ))}
          <div style={{ height: 1, background: 'var(--c-merchant-hover)', margin: '4px 0' }} />
          <button
            type="button"
            onClick={logout}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              width: '100%',
              padding: '11px 16px',
              fontSize: 13,
              color: 'var(--c-merchant-danger)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontFamily: 'inherit',
              textAlign: 'left',
            }}
          >
            <span style={{ color: 'var(--c-merchant-danger)', opacity: 0.8 }}>{Ic.logout}</span>
            Logout
          </button>
        </div>
      )}
    </div>
  );
}

// ── Layout ────────────────────────────────────────────────────────────────────
export default function MerchantLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  if (AUTH_PATHS.some((p) => pathname.startsWith(p))) return <>{children}</>;

  async function logout() {
    await fetch('/api/merchant/logout', { method: 'POST' });
    router.push('/merchant/login');
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--c-merchant-bg)' }}>
      {/* ── Sidebar ── */}
      <aside
        style={{
          width: W,
          minHeight: '100vh',
          background: 'var(--c-white)',
          position: 'fixed',
          top: 0,
          left: 0,
          bottom: 0,
          display: 'flex',
          flexDirection: 'column',
          zIndex: 50,
          borderRight: '1px solid var(--c-merchant-border)',
        }}
      >
        {/* Logo */}
        <div
          style={{ padding: '22px 24px 18px', borderBottom: '1px solid var(--c-merchant-hover)' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: 'linear-gradient(135deg,#7c5cfc,#c44dfa)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                boxShadow: '0 2px 8px rgba(124,92,252,0.3)',
              }}
            >
              <svg
                aria-hidden="true"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="white"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
            </div>
            <div>
              <p
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  color: 'var(--c-text)',
                  margin: 0,
                  lineHeight: 1.2,
                }}
              >
                Ai Vastra
              </p>
              <p style={{ fontSize: 11, color: 'var(--c-merchant-text-placeholder)', margin: 0 }}>
                Merchant Portal
              </p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: '16px 12px', overflowY: 'auto' }}>
          {NAV.map(({ section, items }) => (
            <div key={section} style={{ marginBottom: 6 }}>
              <p
                style={{
                  padding: '8px 12px 4px',
                  fontSize: 10,
                  fontWeight: 700,
                  color: 'var(--c-merchant-divider)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  margin: 0,
                }}
              >
                {section}
              </p>
              {items.map(({ label, href, icon }) => {
                const active = pathname === href;
                return (
                  <Link
                    key={href}
                    href={href}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '9px 12px',
                      borderRadius: 8,
                      marginBottom: 2,
                      fontSize: 13.5,
                      fontWeight: active ? 600 : 400,
                      color: active ? 'var(--c-merchant-accent)' : 'var(--c-merchant-text-muted)',
                      background: active ? 'var(--c-merchant-accent-light)' : 'transparent',
                      textDecoration: 'none',
                      transition: 'background 0.15s, color 0.15s',
                    }}
                  >
                    <span style={{ flexShrink: 0, opacity: active ? 1 : 0.7 }}>{icon}</span>
                    {label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Logout */}
        <div style={{ padding: '12px', borderTop: '1px solid var(--c-merchant-hover)' }}>
          <button
            type="button"
            onClick={logout}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              width: '100%',
              padding: '9px 12px',
              borderRadius: 8,
              fontSize: 13.5,
              color: 'var(--c-merchant-danger)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontFamily: 'inherit',
              textAlign: 'left',
            }}
          >
            <span style={{ opacity: 0.8 }}>{Ic.logout}</span>
            Logout
          </button>
        </div>
      </aside>

      {/* ── Right side ── */}
      <div
        style={{
          marginLeft: W,
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minHeight: '100vh',
        }}
      >
        {/* Top bar */}
        <header
          style={{
            height: 60,
            background: 'var(--c-white)',
            borderBottom: '1px solid var(--c-merchant-border)',
            display: 'flex',
            alignItems: 'center',
            padding: '0 32px',
            gap: 16,
            position: 'sticky',
            top: 0,
            zIndex: 40,
          }}
        >
          <div
            style={{
              flex: 1,
              maxWidth: 360,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: 'var(--c-merchant-bg)',
              border: '1px solid var(--c-merchant-border-light)',
              borderRadius: 10,
              padding: '8px 14px',
            }}
          >
            <span style={{ color: 'var(--c-merchant-text-placeholder)', flexShrink: 0 }}>
              {Ic.search}
            </span>
            <input
              placeholder="Search..."
              style={{
                border: 'none',
                background: 'none',
                outline: 'none',
                fontSize: 13,
                color: 'var(--c-merchant-text-secondary)',
                width: '100%',
                fontFamily: 'inherit',
              }}
            />
          </div>
          {/* AI Virtual Try-On button */}
          <Link
            href="/merchant/tryon-results"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: 163,
              height: 40,
              padding: '0 10px',
              borderRadius: 8,
              background: 'linear-gradient(180deg, #7C3AED 0%, #310380 100%)',
              boxSizing: 'border-box',
              color: '#fff',
              fontSize: 13,
              fontWeight: 600,
              textDecoration: 'none',
              whiteSpace: 'nowrap',
              flexShrink: 0,
              boxShadow: '0 2px 8px rgba(124,58,237,0.35)',
            }}
          >
            <Shirt size={15} />
            AI Virtual Try-On
          </Link>

          {/* Support button */}
          <SupportButton />

          <AdminDropdown />
          <ThemeToggle />
        </header>

        <main style={{ flex: 1, padding: '32px 36px' }}>{children}</main>
      </div>
    </div>
  );
}
