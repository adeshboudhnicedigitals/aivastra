'use client';
import {
  BarChart3,
  Contact,
  LayoutDashboard,
  Lightbulb,
  LogOut,
  MonitorSmartphone,
  Package,
  Settings,
  ShoppingCart,
  Store,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { MoonIcon, SunIcon } from '@/components/icons';
import { LogoAuth } from '@/components/logo';
import { useSession } from '@/components/session-provider';
import { C, M } from '@/components/tokens';
import { signOut } from '@/lib/api';
import { canManageOrg } from '@/lib/roles';

const SIDEBAR_WIDTH = 220;

type NavItem = {
  href: string;
  label: string;
  icon: typeof Store;
  adminOnly: boolean;
  group: 'MAIN' | 'SETUP';
};

const NAV: NavItem[] = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard, adminOnly: false, group: 'MAIN' },
  { href: '/insights', label: 'Insights', icon: Lightbulb, adminOnly: false, group: 'MAIN' },
  {
    href: '/performance',
    label: 'Performance',
    icon: BarChart3,
    adminOnly: true,
    group: 'MAIN',
  },
  { href: '/catalogue', label: 'Catalogue', icon: Package, adminOnly: false, group: 'MAIN' },
  { href: '/carts', label: 'Bill a Cart', icon: ShoppingCart, adminOnly: false, group: 'MAIN' },
  { href: '/customers', label: 'Customers', icon: Contact, adminOnly: true, group: 'MAIN' },
  { href: '/branches', label: 'Branches', icon: Store, adminOnly: true, group: 'MAIN' },
  { href: '/staff', label: 'Staff', icon: Users, adminOnly: true, group: 'MAIN' },
  {
    href: '/devices',
    label: 'Devices',
    icon: MonitorSmartphone,
    adminOnly: false,
    group: 'MAIN',
  },
  { href: '/settings', label: 'Settings', icon: Settings, adminOnly: true, group: 'SETUP' },
];
const GROUP_ORDER: NavItem['group'][] = ['MAIN', 'SETUP'];

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
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      style={pill}
    >
      {dark ? <MoonIcon /> : <SunIcon />}
    </button>
  );
}

/** The design's white 38px-high bordered control, used for the top-bar actions. */
const pill: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  height: 38,
  minWidth: 38,
  padding: '0 12px',
  borderRadius: 48,
  border: `1px solid ${C.border2}`,
  background: C.white,
  color: C.text,
  fontFamily: 'inherit',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};

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
        flexShrink: 0,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          height: 70,
          display: 'flex',
          alignItems: 'center',
          paddingLeft: 20,
          flexShrink: 0,
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
          marginTop: 20,
          padding: '0 12px 16px 20px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
        }}
      >
        {GROUP_ORDER.map((group) => {
          const groupItems = items.filter((i) => i.group === group);
          if (groupItems.length === 0) return null;
          return (
            <div key={group} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {groupItems.map(({ href, label, icon: Icon }) => {
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
                      boxSizing: 'border-box',
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
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

function TopBar() {
  const { me } = useSession();
  const initial = (me?.companyName ?? 'A').trim().charAt(0).toUpperCase() || 'A';
  return (
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
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {me?.companyName ?? 'AiVastra'}
        </div>
        <div style={{ fontSize: 12, fontWeight: 600, color: C.mid }}>
          {me?.role === 'staff' ? 'Staff' : 'Merchant admin'}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <ThemeToggle />
        <button type="button" onClick={() => void signOut()} style={{ ...pill, borderRadius: 8 }}>
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
  );
}

/** Desktop: dark rail + a rounded panel holding the top bar. Phone width: bottom nav. */
export function Shell({ children }: { children: React.ReactNode }): React.ReactElement {
  const { me } = useSession();
  const isActive = useIsActive();
  const items = NAV.filter((n) => !n.adminOnly || (me && canManageOrg(me.role)));

  return (
    <div style={{ display: 'flex', minHeight: '100dvh', background: 'var(--c-side-nav)' }}>
      <Sidebar items={items} />
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
                color: active ? M.brand : C.mid,
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
      <main
        tabIndex={-1}
        className="flex min-w-0 flex-1 flex-col gap-4 p-4 pb-24 md:m-5 md:ml-0 md:rounded-[20px] md:p-5"
        style={{ background: C.bg }}
      >
        <TopBar />
        {children}
      </main>
    </div>
  );
}
