'use client';
import { useQueryClient } from '@tanstack/react-query';
import { KeyRound, MonitorPlay, Package, Phone } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { MoonIcon, SunIcon } from './icons';
import { C } from './tokens';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

const NAV: {
  id: string;
  href: string;
  label: string;
  icon: string;
  badge?: string;
  devOnly?: boolean;
}[] = [
  { id: 'studio', href: '/studio', label: 'Studio', icon: `${BASE}/assets/studio-icon.svg` },
  {
    id: 'tryon',
    href: '/tryon',
    label: 'Try-On',
    icon: `${BASE}/assets/tryon-icon.svg`,
    badge: 'New',
  },
  // Standalone saree feature — superseded by the flat-saree garment type in
  // Studio. Not removed (still fully functional, kept for historical-data
  // reasons), just hidden from the sidebar for now.
  // {
  //   id: 'saree',
  //   href: '/saree',
  //   label: 'Saree',
  //   icon: `${BASE}/assets/saree-icon.svg`,
  //   badge: 'New',
  // },
  {
    id: 'catalogues',
    href: '/catalogues',
    label: 'Catalogues',
    icon: `${BASE}/assets/catalog-icon.svg`,
  },
  { id: 'assets', href: '/assets', label: 'My Products', icon: `${BASE}/assets/asset-icon.svg` },
  // Merchant virtual try-on catalogue management — backend wired up but not
  // fully complete yet. Hidden from the sidebar in production until it's ready.
  {
    id: 'catalogue-manager',
    href: '/catalogue-manager',
    label: 'My Catalogue',
    icon: 'package',
    devOnly: true,
  },
  {
    id: 'developers',
    href: '/developers',
    label: 'Developers',
    icon: 'key',
    devOnly: true,
  },
  { id: 'pricing', href: '/pricing', label: 'Pricing', icon: `${BASE}/assets/pricing-icon.svg` },
  // Placeholder content (dummy videos) — hidden from the sidebar in production
  // until real tutorials are recorded. Route itself is also blocked, see middleware.ts.
  {
    id: 'tutorials',
    href: '/tutorials',
    label: 'Tutorials',
    icon: 'monitor-play',
    devOnly: true,
  },
  { id: 'contact', href: '/contact-us', label: 'Contact Us', icon: 'phone' },
];

const SIDEBAR_WIDTH = 100;

export function Sidebar() {
  const pathname = usePathname();
  const qc = useQueryClient();
  const [darkMode, setDarkMode] = useState(false);

  useEffect(() => {
    setDarkMode(document.documentElement.classList.contains('dark'));
  }, []);

  function toggleTheme() {
    const next = !darkMode;
    setDarkMode(next);
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('theme', next ? 'dark' : 'light');
  }

  // Prefetch a route's primary data on hover/focus so the page opens from cache.
  function prefetchRoute(id: string) {
    if (id === 'catalogues') {
      qc.prefetchQuery({ queryKey: ['catalogues'], queryFn: () => api.get('/v1/catalogues') });
    } else if (id === 'pricing') {
      qc.prefetchQuery({
        queryKey: ['credit-plans'],
        queryFn: () => api.get('/v1/payments/plans'),
        staleTime: 5 * 60 * 1000,
      });
    } else if (id === 'assets') {
      qc.prefetchQuery({ queryKey: ['assets'], queryFn: () => api.get('/v1/assets') });
    } else if (id === 'studio') {
      qc.prefetchQuery({
        queryKey: ['garmentTypes', 'women'],
        queryFn: () => api.get('/v1/models/garment-types?gender=women'),
      });
    } else if (id === 'saree') {
      qc.prefetchQuery({ queryKey: ['saree-config'], queryFn: () => api.get('/v1/saree/config') });
    }
  }

  const activeId = NAV.find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  )?.id;
  const visibleNav =
    process.env.NODE_ENV === 'production' ? NAV.filter((item) => !item.devOnly) : NAV;

  return (
    <div
      style={{
        width: SIDEBAR_WIDTH,
        minWidth: SIDEBAR_WIDTH,
        height: '100vh',
        background: C.dark,
        display: 'flex',
        flexDirection: 'column',
        borderRight: `1px solid ${C.dark2}`,
        position: 'sticky',
        top: 0,
        flexShrink: 0,
        overflow: 'hidden',
      }}
    >
      {/* Logo row */}
      <div
        style={{
          height: 76,
          borderBottom: '1px solid rgba(255,255,255,0.07)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxSizing: 'border-box',
          flexShrink: 0,
        }}
      >
        <Link href="/studio" style={{ display: 'flex', alignItems: 'center' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {/* biome-ignore lint/performance/noImgElement: sidebar logo */}
          <img
            src={`${BASE}/assets/logo.svg`}
            alt="Ai Vastra"
            style={{ height: 28, width: 'auto', flexShrink: 0 }}
          />
        </Link>
      </div>

      {/* Nav */}
      <nav
        style={{
          padding: '16px 10px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        {visibleNav.map((item) => {
          const isActive = activeId === item.id;
          const linkContent = (
            <div
              style={{
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 4,
              }}
            >
              {'badge' in item && item.badge && (
                <div
                  style={{
                    position: 'absolute',
                    top: -4,
                    right: -8,
                    background: 'linear-gradient(180deg, #7c3aed 0%, #66479c 100%)',
                    borderRadius: 4,
                    padding: '1px 4px',
                    fontSize: 7,
                    fontWeight: 600,
                    color: '#fff',
                    lineHeight: '11px',
                    pointerEvents: 'none',
                  }}
                >
                  {item.badge}
                </div>
              )}
              <span style={{ opacity: isActive ? 1 : 0.6, display: 'flex', flexShrink: 0 }}>
                {item.icon === 'monitor-play' ? (
                  <MonitorPlay size={20} />
                ) : item.icon === 'phone' ? (
                  <Phone size={20} />
                ) : item.icon === 'package' ? (
                  <Package size={20} />
                ) : item.icon === 'key' ? (
                  <KeyRound size={20} />
                ) : (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {/* biome-ignore lint/performance/noImgElement: sidebar nav icon */}
                    <img
                      src={item.icon}
                      alt=""
                      width={20}
                      height={20}
                      style={item.id === 'saree' ? { filter: 'invert(1)' } : undefined}
                    />
                  </>
                )}
              </span>
              <span
                style={{
                  opacity: isActive ? 1 : 0.8,
                  fontSize: 10,
                  lineHeight: 1.2,
                  textAlign: 'center',
                  whiteSpace: 'nowrap',
                }}
              >
                {item.label}
              </span>
            </div>
          );

          if (isActive) {
            return (
              <div
                key={item.id}
                style={{
                  borderRadius: 8,
                  padding: 1,
                  background:
                    'linear-gradient(90deg, rgba(245, 92, 122, 0.5) 0%, rgba(246, 181, 83, 0.5) 100%)',
                  boxSizing: 'border-box',
                  overflow: 'hidden',
                }}
              >
                <Link
                  href={item.href}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 4,
                    padding: '8px 4px',
                    borderRadius: 7,
                    textDecoration: 'none',
                    justifyContent: 'center',
                    width: '100%',
                    backgroundColor: '#141414',
                    backgroundImage:
                      'linear-gradient(90deg, rgba(245, 92, 122, 0.15) 0%, rgba(246, 181, 83, 0.15) 100%)',
                    color: C.onDark,
                    fontWeight: 500,
                  }}
                >
                  {linkContent}
                </Link>
              </div>
            );
          }

          return (
            <Link
              key={item.id}
              href={item.href}
              className={isActive ? '' : 'hover-surface-sidebar'}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 4,
                padding: '8px 4px',
                borderRadius: 8,
                textDecoration: 'none',
                justifyContent: 'center',
                background: 'transparent',
                color: isActive ? C.onDark : '#EEEEEE',
                fontWeight: 500,
                transition: 'background .15s',
              }}
              onMouseEnter={() => prefetchRoute(item.id)}
              onFocus={() => prefetchRoute(item.id)}
            >
              {linkContent}
            </Link>
          );
        })}
      </nav>

      {/* Theme toggle */}
      <div
        style={{
          marginTop: 'auto',
          padding: '10px',
          display: 'flex',
          flexDirection: 'row',
          gap: 4,
          justifyContent: 'center',
        }}
      >
        <button
          type="button"
          onClick={() => toggleTheme()}
          title="Light mode"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 8,
            borderRadius: 8,
            border: 'none',
            cursor: 'pointer',
            background: !darkMode
              ? 'linear-gradient(90deg, rgba(245, 92, 122, 0.15) 0%, rgba(246, 181, 83, 0.15) 5%)'
              : 'transparent',
            color: !darkMode ? C.onDark : 'rgba(255,255,255,0.4)',
            transition: 'background .15s, color .15s',
          }}
        >
          <SunIcon />
        </button>
        <button
          type="button"
          onClick={() => toggleTheme()}
          title="Dark mode"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 8,
            borderRadius: 8,
            border: 'none',
            cursor: 'pointer',
            background: darkMode
              ? 'linear-gradient(90deg, rgba(245, 92, 122, 0.15) 0%, rgba(246, 181, 83, 0.15) 5%)'
              : 'transparent',
            color: darkMode ? C.onDark : 'rgba(255,255,255,0.4)',
            transition: 'background .15s, color .15s',
          }}
        >
          <MoonIcon />
        </button>
      </div>
    </div>
  );
}
