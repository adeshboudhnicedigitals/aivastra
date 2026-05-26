'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface CreditsResponse { balance: number }
interface MeResponse { email: string; displayName: string | null }

const StudioIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>
  </svg>
);
const CatalogueIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 6h16M4 10h16M4 14h16M4 18h16"/>
  </svg>
);
const AssetsIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 002 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/>
    <path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"/>
  </svg>
);
const PricingIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2a10 10 0 100 20A10 10 0 0012 2zm0 0v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>
  </svg>
);
const SettingsIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/>
  </svg>
);
const PlusIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 5v14M5 12h14"/>
  </svg>
);
const LogOutIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/>
    <path d="M16 17l5-5-5-5M21 12H9"/>
  </svg>
);

const NAV_ITEMS = [
  { id: 'studio',     href: '/tryon',     label: 'Studio',     icon: <StudioIcon /> },
  { id: 'catalogues', href: '/dashboard', label: 'Catalogues', icon: <CatalogueIcon /> },
  { id: 'assets',     href: '/assets',    label: 'Assets',     icon: <AssetsIcon /> },
  { id: 'pricing',    href: '/credits',   label: 'Pricing',    icon: <PricingIcon /> },
  { id: 'settings',   href: '/account',   label: 'Settings',   icon: <SettingsIcon /> },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  const { data: credits } = useQuery<CreditsResponse>({
    queryKey: ['credits'],
    queryFn: () => api.get('/v1/credits'),
  });

  const { data: me } = useQuery<MeResponse>({
    queryKey: ['me'],
    queryFn: () => api.get('/v1/me'),
    retry: false,
  });

  const balance = credits?.balance ?? 0;
  const maxBalance = 2500;

  const email = me?.email ?? '';
  const displayName = me?.displayName ?? email.split('@')[0] ?? 'User';
  const initials = displayName.slice(0, 2).toUpperCase() || 'U';

  const activeId = NAV_ITEMS.find(
    (item) => pathname === item.href || pathname.startsWith(item.href + '/')
  )?.id;

  async function handleSignOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  return (
    <aside style={{
      width: 260, minWidth: 260, height: '100vh',
      background: '#141414',
      display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
      borderRight: '1px solid #282828',
      position: 'sticky', top: 0, flexShrink: 0,
    }}>
      {/* Top */}
      <div>
        {/* Logo row */}
        <div style={{
          padding: '24px 20px 20px',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <Link href="/tryon" style={{ display: 'flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`${BASE}/assets/logo-icon.png`} alt="" style={{ height: 24, width: 'auto' }} />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`${BASE}/assets/logo-wordmark.png`} alt="Ai Vastra" style={{ height: 20, width: 'auto', filter: 'brightness(0) invert(1)' }} />
          </Link>
        </div>

        {/* Nav */}
        <nav style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {NAV_ITEMS.map((item) => {
            const isActive = activeId === item.id;
            return (
              <Link
                key={item.id}
                href={item.href}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 16px', borderRadius: 8,
                  background: isActive
                    ? 'linear-gradient(135deg, rgba(245,92,122,0.15), rgba(246,181,83,0.15))'
                    : 'transparent',
                  color: '#FEFEFE',
                  fontFamily: 'var(--font-poppins, inherit)',
                  fontWeight: 500, fontSize: 14,
                  textDecoration: 'none',
                  transition: 'background .15s',
                }}
                onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
                onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
              >
                <span style={{ opacity: isActive ? 1 : 0.6 }}>{item.icon}</span>
                <span style={{ opacity: isActive ? 1 : 0.8 }}>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Bottom */}
      <div style={{ padding: '0 20px 20px' }}>
        {/* Credits widget */}
        <div style={{
          borderRadius: 12,
          background: 'rgba(249,249,249,0.05)',
          border: '1px solid rgba(227,227,227,0.10)',
          padding: '14px 16px',
          marginBottom: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 14 }}>🔗</span>
              <span style={{ color: '#FEFEFE', fontSize: 13, fontWeight: 500 }}>Credits Left:</span>
            </div>
            <span style={{ color: '#FEFEFE', fontSize: 13, fontWeight: 500 }}>
              {balance}<span style={{ color: '#888', fontSize: 11 }}>/{maxBalance}</span>
            </span>
          </div>
          <Link href="/credits" style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            width: '100%', padding: '7px 12px', borderRadius: 6, border: 'none', cursor: 'pointer',
            background: 'rgba(255,255,255,0.08)', color: '#FEFEFE',
            fontFamily: 'var(--font-poppins, inherit)', fontSize: 13, fontWeight: 500,
            textDecoration: 'none',
          }}>
            <PlusIcon /> Credit Top-up
          </Link>
        </div>

        {/* User row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Link href="/account" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', flex: 1, minWidth: 0 }}>
            <div style={{
              width: 38, height: 38, borderRadius: 8, background: '#FCE8CA',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 13, fontWeight: 600, color: '#141414', flexShrink: 0,
            }}>{initials}</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ color: '#FEFEFE', fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName}</div>
              {email && <div style={{ color: '#EEEEEE', fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{email}</div>}
            </div>
          </Link>
          <button onClick={() => void handleSignOut()} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#666', flexShrink: 0, padding: 4 }} title="Sign out">
            <LogOutIcon />
          </button>
        </div>
      </div>
    </aside>
  );
}
