'use client';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { api } from '@/lib/api';
import { C } from './tokens';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

const NAV = [
  { id: 'studio', href: '/studio', label: 'Studio', icon: `${BASE}/assets/studio-icon.svg` },
  {
    id: 'tryon',
    href: '/tryon',
    label: 'Try-On',
    icon: `${BASE}/assets/tryon-icon.svg`,
    badge: 'New',
  },
  {
    id: 'catalogues',
    href: '/catalogues',
    label: 'Catalogues',
    icon: `${BASE}/assets/catalog-icon.svg`,
  },
  { id: 'assets', href: '/assets', label: 'My Products', icon: `${BASE}/assets/asset-icon.svg` },
  { id: 'pricing', href: '/pricing', label: 'Pricing', icon: `${BASE}/assets/pricing-icon.svg` },
];

const SIDEBAR_WIDTH = 100;

export function Sidebar() {
  const pathname = usePathname();
  const qc = useQueryClient();

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
    }
  }

  const activeId = NAV.find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  )?.id;

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
        {NAV.map((item) => {
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
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={item.icon} alt="" width={20} height={20} />
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
              onMouseEnter={(e) => {
                if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                prefetchRoute(item.id);
              }}
              onFocus={() => prefetchRoute(item.id)}
              onMouseLeave={(e) => {
                if (!isActive) e.currentTarget.style.background = 'transparent';
              }}
            >
              {linkContent}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
