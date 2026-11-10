'use client';
import {
  BarChart3,
  LayoutDashboard,
  LogOut,
  MonitorSmartphone,
  Package,
  Settings,
  Store,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { MoonIcon, SunIcon } from '@/components/icons';
import { LogoAuth } from '@/components/logo';
import { useSession } from '@/components/session-provider';
import { C } from '@/components/tokens';
import { signOut } from '@/lib/api';
import { canManageOrg } from '@/lib/roles';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const SIDEBAR_WIDTH = 200;

type NavItem = {
  href: string;
  label: string;
  icon: typeof Store;
  adminOnly: boolean;
  group: 'MANAGE' | 'INSIGHTS' | 'SETUP';
};

const NAV: NavItem[] = [
  { href: '/', label: 'Overview', icon: LayoutDashboard, adminOnly: false, group: 'INSIGHTS' },
  {
    href: '/performance',
    label: 'Performance',
    icon: BarChart3,
    adminOnly: true,
    group: 'INSIGHTS',
  },
  { href: '/catalogue', label: 'Catalogue', icon: Package, adminOnly: false, group: 'MANAGE' },
  { href: '/branches', label: 'Branches', icon: Store, adminOnly: true, group: 'MANAGE' },
  { href: '/staff', label: 'Staff', icon: Users, adminOnly: true, group: 'MANAGE' },
  {
    href: '/devices',
    label: 'Devices',
    icon: MonitorSmartphone,
    adminOnly: false,
    group: 'MANAGE',
  },
  { href: '/settings', label: 'Settings', icon: Settings, adminOnly: true, group: 'SETUP' },
];
const GROUP_ORDER: NavItem['group'][] = ['INSIGHTS', 'MANAGE', 'SETUP'];

function useIsActive() {
  const pathname = usePathname();
  return (href: string) =>
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
  }, []);
  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem('theme', next ? 'dark' : 'light');
    } catch {
      // storage blocked: the toggle still works for this page view
    }
  }
  return (
    <button
      type="button"
      onClick={toggle}
      className="mw-side-btn"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '10px 16px',
        borderRadius: 8,
        background: 'rgba(57, 61, 70, 0.2)',
        border: '1px solid rgba(57, 61, 70, 0.5)',
        color: '#FFFFFF',
        width: '100%',
        cursor: 'pointer',
        fontSize: 12,
        fontWeight: 500,
        fontFamily: 'inherit',
        boxSizing: 'border-box',
      }}
    >
      {dark ? <MoonIcon /> : <SunIcon />}
      <span>{dark ? 'Dark Theme' : 'Light Theme'}</span>
    </button>
  );
}

function Sidebar({ items }: { items: NavItem[] }) {
  const isActive = useIsActive();
  return (
    <aside
      className="hidden md:flex"
      style={{
        width: SIDEBAR_WIDTH,
        minWidth: SIDEBAR_WIDTH,
        height: '100vh',
        position: 'sticky',
        top: 0,
        flexDirection: 'column',
        background: 'var(--c-side-nav)',
        borderRight: '1px solid rgba(57, 61, 70, 0.4)',
        flexShrink: 0,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          height: 76,
          borderBottom: '1px solid rgba(57, 61, 70, 0.4)',
          display: 'flex',
          alignItems: 'center',
          paddingLeft: 20,
          flexShrink: 0,
          boxSizing: 'border-box',
        }}
      >
        <Link href="/" aria-label="AiVastra Merchant home" style={{ display: 'flex' }}>
          <LogoAuth />
        </Link>
      </div>
      <nav
        aria-label="Main"
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        {GROUP_ORDER.map((group) => {
          const groupItems = items.filter((i) => i.group === group);
          if (groupItems.length === 0) return null;
          return (
            <div key={group} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 500,
                  color: '#B2B4B7',
                  paddingLeft: 12,
                  letterSpacing: '0.05em',
                }}
              >
                {group}
              </span>
              {groupItems.map(({ href, label, icon: Icon }) => {
                const active = isActive(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    aria-current={active ? 'page' : undefined}
                    className={active ? undefined : 'mw-side-link'}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '10px 16px',
                      borderRadius: 8,
                      textDecoration: 'none',
                      boxSizing: 'border-box',
                      boxShadow: active ? 'inset 3px 0 0 0 #BD2587' : 'none',
                      background: active
                        ? 'linear-gradient(90deg, rgba(189, 37, 135, 0.15) 0%, rgba(189, 37, 135, 0) 100%)'
                        : 'transparent',
                      transition: 'box-shadow 0.2s, background-color 0.2s',
                    }}
                  >
                    <Icon size={16} aria-hidden="true" color={active ? '#FFFFFF' : '#BABABB'} />
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: active ? 600 : 500,
                        color: active ? '#FFFFFF' : '#B2B4B7',
                      }}
                    >
                      {label}
                    </span>
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>
      <div style={{ padding: '0 12px 16px', flexShrink: 0 }}>
        <ThemeToggle />
      </div>
    </aside>
  );
}

function TopBar() {
  const { me } = useSession();
  const initial = (me?.companyName ?? 'A').trim().charAt(0).toUpperCase() || 'A';
  return (
    <header
      style={{
        height: 76,
        background: C.navbar,
        borderBottom: `1px solid ${C.border}`,
        padding: '0 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        flexShrink: 0,
        boxSizing: 'border-box',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontWeight: 600,
            fontSize: 18,
            color: C.text,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {me?.companyName ?? 'AiVastra'}
        </div>
        <div style={{ fontSize: 13, fontWeight: 500, color: C.mid }}>
          {me?.role === 'staff' ? 'Staff' : 'Merchant admin'}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <span
          aria-hidden="true"
          style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'linear-gradient(135deg, #7c3aed 0%, #BD2587 100%)',
            color: '#fff',
            fontWeight: 700,
            fontSize: 14,
          }}
        >
          {initial}
        </span>
        <button
          type="button"
          onClick={() => void signOut()}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            height: 36,
            padding: '0 12px',
            borderRadius: 8,
            border: `1px solid ${C.border2}`,
            background: C.white,
            color: C.text,
            fontFamily: 'inherit',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          <LogOut size={14} aria-hidden="true" />
          Sign out
        </button>
      </div>
    </header>
  );
}

/** Desktop: dark sidebar + top bar. Phone width: top bar + bottom nav. */
export function Shell({ children }: { children: React.ReactNode }): React.ReactElement {
  const { me } = useSession();
  const isActive = useIsActive();
  const items = NAV.filter((n) => !n.adminOnly || (me && canManageOrg(me.role)));

  return (
    <div style={{ display: 'flex', minHeight: '100dvh' }}>
      <Sidebar items={items} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <TopBar />
        <nav
          aria-label="Main"
          className="fixed bottom-0 left-0 right-0 z-40 flex h-[var(--mw-nav-h)] justify-around overflow-x-auto md:hidden"
          style={{ background: C.navbar, borderTop: `1px solid ${C.border}` }}
        >
          {items.map(({ href, label, icon: Icon }) => {
            const active = isActive(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className="flex min-w-[64px] flex-1 shrink-0 flex-col items-center gap-1 px-2 py-2 text-xs"
                style={{
                  color: active ? C.pink : C.mid,
                  fontWeight: active ? 700 : 500,
                  textDecoration: 'none',
                }}
              >
                <Icon size={18} aria-hidden="true" />
                {label}
              </Link>
            );
          })}
        </nav>
        <main tabIndex={-1} className="min-w-0 flex-1 p-4 pb-24 md:p-6 md:pb-6">
          {children}
        </main>
      </div>
    </div>
  );
}
