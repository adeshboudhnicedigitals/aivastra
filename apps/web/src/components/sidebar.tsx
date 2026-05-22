'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
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

const MoreIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/>
  </svg>
);

const CheckIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12l5 5L20 7"/>
  </svg>
);

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

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  const balance = credits?.balance ?? 0;
  const maxBalance = 2500;
  const fillPct = Math.min(100, Math.round((balance / maxBalance) * 100));

  const email = me?.email ?? '';
  const displayName = me?.displayName ?? email.split('@')[0] ?? 'User';
  const initials = displayName.slice(0, 2).toUpperCase() || 'U';

  const activeId = NAV_ITEMS.find((item) => pathname === item.href || pathname.startsWith(item.href + '/'))?.id;

  return (
    <aside className="av-sidebar">
      <div className="av-sb-top">
        <Link className="av-logo" href="/dashboard">
          <div className="av-logo-mark">Av</div>
          <span className="av-logo-name">Ai Vastra</span>
        </Link>
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

      <button className="av-user" onClick={handleLogout} title="Sign out" style={{ border: 0, width: '100%', textAlign: 'left' }}>
        <div className="av-avatar">{initials}</div>
        <div className="av-user-meta">
          <div className="av-user-name">{displayName}</div>
          {email && <div className="av-user-mail">{email}</div>}
        </div>
        <span style={{ color: 'var(--sidebar-mute)' }}><MoreIcon /></span>
      </button>
    </aside>
  );
}
