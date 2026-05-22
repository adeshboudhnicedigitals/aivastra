'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface CreditsResponse { balance: number }
interface MeResponse { email: string; displayName: string | null }

const NAV_ITEMS = [
  {
    id: 'home',
    href: '/',
    label: 'Home',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
        <polyline points="9 22 9 12 15 12 15 22"/>
      </svg>
    ),
  },
  {
    id: 'studio',
    href: '/tryon',
    label: 'Studio',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M15 4V2"/><path d="M15 16v-2"/><path d="M8 9h2"/><path d="M20 9h2"/>
        <path d="M17.8 11.8L19 13"/><path d="M15 9h0"/><path d="M17.8 6.2L19 5"/>
        <path d="M3 21l9-9"/><path d="M12.2 6.2L11 5"/>
      </svg>
    ),
  },
  {
    id: 'catalogues',
    href: '/dashboard',
    label: 'Catalogues',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1.5"/>
        <rect x="14" y="3" width="7" height="7" rx="1.5"/>
        <rect x="3" y="14" width="7" height="7" rx="1.5"/>
        <rect x="14" y="14" width="7" height="7" rx="1.5"/>
      </svg>
    ),
  },
  {
    id: 'credits',
    href: '/credits',
    label: 'Credits',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 3h12"/><path d="M6 8h12"/><path d="M6 13l9 8"/><path d="M9 13c5 0 7-2 7-5"/>
      </svg>
    ),
  },
];

const SparkIcon = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="white">
    <path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4z"/>
  </svg>
);

const BoltIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
    <path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z"/>
  </svg>
);

const SettingsIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  </svg>
);

const SidebarToggleIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="currentColor">
    <path d="M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm120-80v-560H200v560h120Zm80 0h360v-560H400v560Zm-80 0H200h120Z"/>
  </svg>
);

// eslint-disable-next-line @next/next/no-img-element
const LogoImg = () => (
  <img
    src="/logo.png"
    alt="Ai Vastra"
    style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: 8 }}
  />
);

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

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
  const fillPct = Math.min(100, Math.round((balance / maxBalance) * 100));

  const email = me?.email ?? '';
  const displayName = me?.displayName ?? email.split('@')[0] ?? 'User';
  const initials = displayName.slice(0, 2).toUpperCase() || 'U';

  const activeId = NAV_ITEMS.find((item) => pathname === item.href || pathname.startsWith(item.href + '/'))?.id;

  if (collapsed) {
    return (
      <aside className="av-sidebar av-sidebar--collapsed" onClick={() => setCollapsed(false)} style={{ cursor: 'pointer' }}>
        <div className="av-sb-top">
          <div className="av-sb-logo-toggle">
            <div className="av-logo-mark av-logo-default"><LogoImg /></div>
            <button className="av-logo-mark av-logo-hover" onClick={() => setCollapsed(false)} title="Expand sidebar">
              <SidebarToggleIcon />
            </button>
          </div>
        </div>
        <nav className="av-sb-nav" style={{ marginTop: 20 }}>
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              onClick={(e) => e.stopPropagation()}
              title={item.label}
              className={`av-sb-icon-btn ${activeId === item.id ? 'active' : ''}`}
            >
              {item.icon}
            </Link>
          ))}
        </nav>
        <div className="av-sb-spacer" />
        <Link
          href="/account"
          onClick={(e) => e.stopPropagation()}
          title="Account settings"
          className="av-sb-icon-btn"
        >
          <SettingsIcon />
        </Link>
      </aside>
    );
  }

  return (
    <aside className="av-sidebar">
      <div className="av-sb-top">
        <Link className="av-logo" href="/dashboard">
          <div className="av-logo-mark"><LogoImg /></div>
          <span className="av-logo-name">Ai Vastra</span>
        </Link>
        <button className="av-sb-toggle" onClick={() => setCollapsed(true)} title="Close sidebar">
          <SidebarToggleIcon />
        </button>
      </div>

      <nav className="av-sb-nav">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.id}
            href={item.href}
            className={`av-sb-item ${activeId === item.id ? 'active' : ''}`}
          >
            <span className="av-sb-icon">{item.icon}</span>
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>

      <div className="av-sb-spacer" />

      <div className="av-credits">
        <div className="av-credits-row">
          <div className="av-credits-label">
            <span className="av-credits-dot"><SparkIcon /></span>
            Credits Left
          </div>
          <div className="av-credits-val">
            {balance} <span style={{ color: 'var(--sidebar-mute)', fontWeight: 500 }}>/ {maxBalance}</span>
          </div>
        </div>
        <div className="av-credits-bar">
          <span className="av-credits-fill" style={{ width: `${fillPct}%` }} />
        </div>
        <Link href="/credits" className="av-credits-top">
          <BoltIcon /> Top up credits
        </Link>
      </div>

      <Link className="av-user" href="/account" style={{ textDecoration: 'none' }}>
        <div className="av-avatar">{initials}</div>
        <div className="av-user-meta">
          <div className="av-user-name">{displayName}</div>
          {email && <div className="av-user-mail">{email}</div>}
        </div>
        <span style={{ color: 'var(--sidebar-mute)', flexShrink: 0 }}><SettingsIcon /></span>
      </Link>
    </aside>
  );
}
