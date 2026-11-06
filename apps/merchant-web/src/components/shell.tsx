'use client';
import { LayoutDashboard, LogOut, MonitorSmartphone, Store, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from '@/components/session-provider';
import { C } from '@/components/tokens';
import { signOut } from '@/lib/api';
import { canManageOrg } from '@/lib/roles';

type NavItem = { href: string; label: string; icon: typeof Store; adminOnly: boolean };

const NAV: NavItem[] = [
  { href: '/', label: 'Overview', icon: LayoutDashboard, adminOnly: false },
  { href: '/branches', label: 'Branches', icon: Store, adminOnly: true },
  { href: '/staff', label: 'Staff', icon: Users, adminOnly: true },
  { href: '/devices', label: 'Devices', icon: MonitorSmartphone, adminOnly: false },
];

/** Top bar (company + sign out) with a side nav on desktop and a bottom bar at phone width. */
export function Shell({ children }: { children: React.ReactNode }): React.ReactElement {
  const { me } = useSession();
  const pathname = usePathname();
  const items = NAV.filter((n) => !n.adminOnly || (me && canManageOrg(me.role)));
  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '12px 16px',
          background: C.navbar,
          borderBottom: `1px solid ${C.border}`,
        }}
      >
        <span style={{ fontSize: 16, fontWeight: 700, color: C.text }}>
          {me?.companyName ?? 'AiVastra'}
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
      </header>
      <div className="flex flex-1 flex-col md:flex-row">
        <nav
          aria-label="Main"
          className="fixed bottom-0 left-0 right-0 z-40 flex h-[var(--mw-nav-h)] justify-around md:static md:h-auto md:w-52 md:flex-col md:justify-start md:gap-1 md:p-3"
          style={{ background: C.navbar, borderTop: `1px solid ${C.border}` }}
        >
          {items.map(({ href, label, icon: Icon }) => {
            const active = isActive(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className="flex flex-1 flex-col items-center gap-1 px-2 py-2 text-xs md:flex-none md:flex-row md:gap-2 md:rounded-lg md:px-3 md:text-sm"
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
