'use client';

import {
  BookOpen,
  CreditCard,
  Grid2x2,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  MonitorSmartphone,
  Moon,
  Package,
  PhoneCall,
  Settings,
  Sun,
  UserCircle2,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';

type MerchantMe = {
  companyName?: string;
  contactName?: string;
};

type NavItem = {
  label: string;
  href: string;
  icon: typeof LayoutDashboard;
};

type NavSection = {
  section: string;
  items: NavItem[];
};

const AUTH_PATHS = ['/login', '/signup'];
const SIDEBAR_WIDTH = 260;

const NAV: NavSection[] = [
  {
    section: 'Overview',
    items: [
      { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
      { label: 'Widget Embed', href: '/api-keys', icon: KeyRound },
    ],
  },
  {
    section: 'Kiosk',
    items: [
      { label: 'Kiosk Catalog', href: '/catalog', icon: Package },
      { label: 'My Catalogues', href: '/catalogues', icon: Grid2x2 },
      { label: 'Kiosk Devices', href: '/kiosk-devices', icon: MonitorSmartphone },
    ],
  },
  {
    section: 'Account',
    items: [
      { label: 'Settings', href: '/settings', icon: Settings },
      { label: 'Documentation', href: '/documentation', icon: BookOpen },
      { label: 'Pricing', href: '/pricing', icon: CreditCard },
    ],
  },
];

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function pageTitle(pathname: string) {
  for (const section of NAV) {
    for (const item of section.items) {
      if (isActive(pathname, item.href)) return item.label;
    }
  }
  return 'Merchant Portal';
}

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
      className="btn-icon focus-ring"
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {dark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}

function AccountMenu() {
  const [open, setOpen] = useState(false);
  const [me, setMe] = useState<MerchantMe | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    fetch('/api/merchant/me', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: MerchantMe | null) => setMe(data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    function onMouseDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, []);

  const label = me?.contactName || me?.companyName || 'Merchant Account';
  const initial = label.charAt(0).toUpperCase();

  async function logout() {
    await fetch('/api/merchant/logout', { method: 'POST' });
    router.push('/login');
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="account-btn focus-ring"
      >
        <span
          style={{
            width: 28,
            height: 28,
            borderRadius: 'var(--radius-full)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'hsl(var(--accent-primary))',
            color: 'hsl(var(--text-on-accent))',
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {initial}
        </span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>{label}</span>
      </button>

      {open && (
        <div
          className="animate-slide-up"
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            minWidth: 220,
            borderRadius: 'var(--radius-lg)',
            border: '1px solid hsl(var(--border-default))',
            background: 'hsl(var(--bg-base))',
            boxShadow: 'var(--shadow-lg)',
            overflow: 'hidden',
            zIndex: 100,
          }}
        >
          <div
            style={{
              padding: 'var(--space-3) var(--space-4)',
              borderBottom: '1px solid hsl(var(--border-subtle))',
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 600, color: 'hsl(var(--text-primary))' }}>
              {me?.contactName || 'Account'}
            </div>
            <div style={{ fontSize: 12, color: 'hsl(var(--text-tertiary))', marginTop: 2 }}>
              {me?.companyName || 'Merchant'}
            </div>
          </div>
          <div style={{ padding: 'var(--space-2)' }}>
            <Link href="/profile" onClick={() => setOpen(false)} className="menu-item focus-ring">
              <UserCircle2 size={16} />
              Profile
            </Link>
            <button
              type="button"
              onClick={() => void logout()}
              className="menu-item menu-item-danger focus-ring"
              style={{ marginTop: 'var(--space-1)' }}
            >
              <LogOut size={16} />
              Log out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function MerchantLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const title = useMemo(() => pageTitle(pathname), [pathname]);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 1024);
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (mobileMenuOpen) {
      setMobileMenuOpen(false);
    }
  }, [mobileMenuOpen]);

  if (AUTH_PATHS.some((path) => pathname.startsWith(path))) {
    return <>{children}</>;
  }

  async function logout() {
    await fetch('/api/merchant/logout', { method: 'POST' });
    router.push('/login');
  }

  const SidebarContent = () => (
    <>
      <div
        style={{
          padding: 'var(--space-6)',
          borderBottom: '1px solid hsl(var(--border-subtle))',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <div
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: 'hsl(var(--text-primary))',
              letterSpacing: '-0.02em',
            }}
          >
            Ai Vastra
          </div>
          <div
            style={{
              fontSize: 12,
              fontWeight: 500,
              color: 'hsl(var(--text-tertiary))',
              marginTop: 2,
            }}
          >
            Merchant Portal
          </div>
        </div>
        {isMobile && (
          <button
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'hsl(var(--text-secondary))',
              cursor: 'pointer',
              padding: 'var(--space-2)',
            }}
          >
            <X size={20} />
          </button>
        )}
      </div>

      <nav
        className="no-scrollbar"
        style={{
          flex: 1,
          padding: 'var(--space-4)',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-6)',
        }}
      >
        {NAV.map((section) => (
          <div key={section.section}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: 'hsl(var(--text-tertiary))',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                margin: '0 var(--space-3) var(--space-2)',
              }}
            >
              {section.section}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
              {section.items.map((item) => {
                const active = isActive(pathname, item.href);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`nav-link focus-ring ${active ? 'active' : ''}`.trim()}
                  >
                    <Icon
                      size={18}
                      color={active ? 'hsl(var(--accent-primary))' : 'currentColor'}
                    />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div style={{ padding: 'var(--space-4)', borderTop: '1px solid hsl(var(--border-subtle))' }}>
        <button
          type="button"
          onClick={() => void logout()}
          className="menu-item menu-item-danger focus-ring"
        >
          <LogOut size={18} />
          Log out
        </button>
      </div>
    </>
  );

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'hsl(var(--bg-base))' }}>
      {/* Desktop Sidebar */}
      {!isMobile && (
        <aside
          style={{
            position: 'fixed',
            inset: '0 auto 0 0',
            width: SIDEBAR_WIDTH,
            background: 'hsl(var(--bg-surface))',
            borderRight: '1px solid hsl(var(--border-default))',
            display: 'flex',
            flexDirection: 'column',
            zIndex: 30,
          }}
        >
          <SidebarContent />
        </aside>
      )}

      {/* Mobile Drawer Backdrop */}
      {isMobile && mobileMenuOpen && (
        <button
          type="button"
          aria-label="Close navigation menu"
          className="animate-fade-in"
          onClick={() => setMobileMenuOpen(false)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ' || event.key === 'Escape') {
              setMobileMenuOpen(false);
            }
          }}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            zIndex: 40,
            backdropFilter: 'blur(4px)',
            border: 'none',
            padding: 0,
          }}
        />
      )}

      {/* Mobile Drawer */}
      {isMobile && (
        <aside
          style={{
            position: 'fixed',
            inset: '0 auto 0 0',
            width: 280,
            background: 'hsl(var(--bg-surface))',
            borderRight: '1px solid hsl(var(--border-default))',
            display: 'flex',
            flexDirection: 'column',
            zIndex: 50,
            transform: mobileMenuOpen ? 'translateX(0)' : 'translateX(-100%)',
            transition: 'transform var(--transition-normal)',
            boxShadow: mobileMenuOpen ? 'var(--shadow-xl)' : 'none',
          }}
        >
          <SidebarContent />
        </aside>
      )}

      {/* Main Content Area */}
      <div
        style={{
          flex: 1,
          marginLeft: isMobile ? 0 : SIDEBAR_WIDTH,
          display: 'flex',
          flexDirection: 'column',
          width: isMobile ? '100%' : `calc(100% - ${SIDEBAR_WIDTH}px)`,
        }}
      >
        <header
          className="glass-panel"
          style={{
            height: 64,
            padding: '0 var(--space-6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            position: 'sticky',
            top: 0,
            zIndex: 20,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
            {isMobile && (
              <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                className="focus-ring"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 36,
                  height: 36,
                  background: 'transparent',
                  border: '1px solid hsl(var(--border-default))',
                  borderRadius: 'var(--radius-md)',
                  color: 'hsl(var(--text-primary))',
                  cursor: 'pointer',
                }}
              >
                <Menu size={18} />
              </button>
            )}
            <div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-2)',
                  fontSize: 13,
                  fontWeight: 500,
                  color: 'hsl(var(--text-tertiary))',
                  marginBottom: 2,
                }}
              >
                <span>Merchant Portal</span>
                <span style={{ fontSize: 10 }}>/</span>
              </div>
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 600,
                  color: 'hsl(var(--text-primary))',
                  letterSpacing: '-0.01em',
                }}
              >
                {title}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
            <a
              href="tel:+917729883692"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                color: 'hsl(var(--text-secondary))',
                fontSize: 14,
                fontWeight: 500,
                textDecoration: 'none',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              <PhoneCall size={18} />
              +91 77298 83692
            </a>
            <ThemeToggle />
            <AccountMenu />
          </div>
        </header>

        <main style={{ flex: 1, padding: 'var(--space-8) var(--space-6) var(--space-12)' }}>
          <div style={{ maxWidth: 1200, margin: '0 auto' }}>{children}</div>
        </main>
      </div>
    </div>
  );
}
