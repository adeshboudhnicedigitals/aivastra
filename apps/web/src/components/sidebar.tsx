'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { C } from './tokens';
import { SettingsIcon, LogOutIcon, PlusIcon, DotsIcon } from './icons';

interface CreditsResponse { balance: number }
interface MeResponse { email: string; displayName: string | null }

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

const NAV = [
  { id: 'studio',     href: '/studio',     label: 'Studio',     icon: `${BASE}/assets/studio-icon.svg` },
  { id: 'catalogues', href: '/catalogues', label: 'Catalogues', icon: `${BASE}/assets/catalog-icon.svg` },
  { id: 'assets',     href: '/assets',     label: 'My Products', icon: `${BASE}/assets/asset-icon.svg` },
  { id: 'pricing',    href: '/pricing',    label: 'Pricing',    icon: `${BASE}/assets/pricing-icon.svg` },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [popupOpen, setPopupOpen] = useState(false);
  const [logoHover, setLogoHover] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);

  const { data: credits } = useQuery<CreditsResponse>({ queryKey: ['credits'], queryFn: () => api.get('/v1/credits') });
  const { data: me } = useQuery<MeResponse>({ queryKey: ['me'], queryFn: () => api.get('/v1/me'), retry: false });

  const balance = credits?.balance ?? 0;
  const maxBalance = 2500;
  const email = me?.email ?? '';
  const displayName = me?.displayName ?? email.split('@')[0] ?? 'User';
  const initials = displayName.slice(0, 2).toUpperCase() || 'U';

  const activeId = NAV.find((item) => pathname === item.href || pathname.startsWith(item.href + '/'))?.id;

  async function handleSignOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  const W = collapsed ? 68 : 260;

  return (
    <div
      onClick={() => { if (collapsed) setCollapsed(false); }}
      style={{
        width: W, minWidth: W, height: '100vh', background: C.dark,
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        borderRight: `1px solid ${C.dark2}`, position: 'sticky', top: 0, flexShrink: 0,
        transition: 'width .22s ease, min-width .22s ease',
        cursor: collapsed ? 'pointer' : 'default',
        overflow: 'hidden',
      }}
    >
      {/* Top: logo + nav */}
      <div>
        {/* Logo row */}
        <div
          onMouseEnter={() => setLogoHover(true)}
          onMouseLeave={() => setLogoHover(false)}
          style={{
            padding: '20px 16px',
            borderBottom: '1px solid rgba(255,255,255,0.07)',
            display: 'flex', alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'flex-start',
            minHeight: 68,
          }}
        >
          {/* Logo + dock */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
            {/* Logo — crossfades only when collapsed */}
            <div style={{ position: 'relative', height: 32, display: 'flex', alignItems: 'center' }}>
              <Link
                href="/studio"
                onClick={(e) => e.stopPropagation()}
                style={{
                  textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6,
                  opacity: collapsed && logoHover ? 0 : 1,
                  transition: 'opacity .18s ease',
                  pointerEvents: collapsed && logoHover ? 'none' : 'auto',
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`${BASE}/assets/logo.svg`} alt="Ai Vastra" style={{ height: 28, width: 'auto', flexShrink: 0 }} />
                <div style={{
                  overflow: 'hidden',
                  maxWidth: collapsed ? 0 : 120,
                  opacity: collapsed ? 0 : 1,
                  transition: 'max-width .22s ease, opacity .18s ease',
                  display: 'flex', alignItems: 'center',
                }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`${BASE}/assets/logo-text.svg`} alt="" style={{ height: 34, width: 'auto', flexShrink: 0 }} />
                </div>
              </Link>

              {/* Dock button — overlaid (crossfade) only when collapsed */}
              {collapsed && (
                <button
                  onClick={(e) => { e.stopPropagation(); setCollapsed(false); setLogoHover(false); }}
                  title="Expand sidebar"
                  style={{
                    position: 'absolute', inset: 0,
                    background: 'none', border: 'none', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    opacity: logoHover ? 1 : 0,
                    transition: 'opacity .18s ease',
                    pointerEvents: logoHover ? 'auto' : 'none',
                    padding: 0,
                  }}
                >
                  <div style={{
                    width: 30, height: 30, borderRadius: 8,
                    background: logoHover ? '#F9F9F91A' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'background .18s ease',
                  }}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#EEEEEE" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="m14 9 3 3-3 3"/></svg>
                  </div>
                </button>
              )}
            </div>

            {/* Dock button (expanded) — always visible */}
            {!collapsed && (
              <button
                onClick={(e) => { e.stopPropagation(); setCollapsed(true); setLogoHover(false); }}
                title="Collapse sidebar"
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  display: 'flex', padding: 0, flexShrink: 0,
                }}
              >
                <div style={{
                  width: 30, height: 30, borderRadius: 8,
                  background: '#F9F9F91A',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#EEEEEE" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="m16 15-3-3 3-3"/></svg>
                </div>
              </button>
            )}
          </div>
        </div>

        {/* Nav */}
        <nav style={{ padding: '16px 10px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {NAV.map((item) => {
            const isActive = activeId === item.id;
            const linkContent = (
              <>
                <span style={{ opacity: isActive ? 1 : 0.6, display: 'flex', flexShrink: 0 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.icon} alt="" width={20} height={20} />
                </span>
                <span style={{
                  opacity: collapsed ? 0 : (isActive ? 1 : 0.8),
                  maxWidth: collapsed ? 0 : 160,
                  overflow: 'hidden', whiteSpace: 'nowrap',
                  transition: 'max-width .22s ease, opacity .18s ease',
                }}>
                  {item.label}
                </span>
              </>
            );

            if (isActive) {
              return (
                <div key={item.id} style={{
                  borderRadius: 8,
                  padding: 1,
                  background: 'linear-gradient(90deg, rgba(245, 92, 122, 0.5) 0%, rgba(246, 181, 83, 0.5) 100%)',
                  width: collapsed ? undefined : 220,
                  height: 40,
                  boxSizing: 'border-box',
                  overflow: 'hidden',
                }}>
                  <Link
                    href={item.href}
                    onClick={(e) => e.stopPropagation()}
                    title={collapsed ? item.label : undefined}
                    style={{
                      display: 'flex', alignItems: 'center',
                      gap: collapsed ? 0 : 8,
                      padding: collapsed ? '10px 0' : '10px 16px',
                      borderRadius: 7, textDecoration: 'none',
                      justifyContent: collapsed ? 'center' : 'flex-start',
                      width: '100%', height: '100%',
                      backgroundColor: '#141414',
                      backgroundImage: 'linear-gradient(90deg, rgba(245, 92, 122, 0.15) 0%, rgba(246, 181, 83, 0.15) 100%)',
                      color: C.white, fontWeight: 500, fontSize: 14,
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
                onClick={(e) => e.stopPropagation()}
                title={collapsed ? item.label : undefined}
                style={{
                  display: 'flex', alignItems: 'center',
                  gap: collapsed ? 0 : 8,
                  padding: collapsed ? '10px 0' : '10px 16px',
                  borderRadius: 8, textDecoration: 'none',
                  justifyContent: collapsed ? 'center' : 'flex-start',
                  width: collapsed ? undefined : 220, height: 40,
                  background: 'transparent',
                  color: isActive ? C.white : '#EEEEEE', fontWeight: 500, fontSize: 14,
                  transition: 'background .15s',
                }}
                onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
                onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
              >
                {linkContent}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Bottom: credits + profile */}
      <div style={{ padding: '0 10px 16px' }}>
        {/* Credits widget — hidden when collapsed */}
        <div style={{
          maxHeight: collapsed ? 0 : 120,
          opacity: collapsed ? 0 : 1,
          overflow: 'hidden',
          transition: 'max-height .22s ease, opacity .18s ease',
          marginBottom: collapsed ? 0 : 12,
        }}>
          <div style={{ borderRadius: 12, background: 'rgba(249,249,249,0.05)', border: '1px solid rgba(227,227,227,0.1)', padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 14 }}>🔗</span>
                <span style={{ color: C.white, fontSize: 13, fontWeight: 500 }}>Credits Left:</span>
              </div>
              <span style={{ color: C.white, fontSize: 13, fontWeight: 500 }}>{balance}<span style={{ color: '#888', fontSize: 11 }}>/{maxBalance}</span></span>
            </div>
            <Link href="/pricing" onClick={(e) => e.stopPropagation()} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, textDecoration: 'none',
              width: '100%', padding: '7px 12px', borderRadius: 6,
              background: 'rgba(255,255,255,0.08)', color: C.white, fontSize: 13, fontWeight: 500,
            }}>
              <PlusIcon /> Buy Credits
            </Link>
          </div>
        </div>

        {/* Profile row with popup */}
        <div ref={popupRef} style={{ position: 'relative' }}>
          {/* Popup */}
          {popupOpen && (
            <>
              <div onClick={(e) => { e.stopPropagation(); setPopupOpen(false); }} style={{ position: 'fixed', inset: 0, zIndex: 99 }} />
              <div style={{
                position: 'absolute', bottom: 'calc(100% + 8px)', left: 0,
                width: 200,
                background: '#1E1E1E', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 10, overflow: 'hidden', zIndex: 100,
                boxShadow: '0 -8px 24px rgba(0,0,0,0.4)',
              }}>
                <Link href="/settings" onClick={(e) => { e.stopPropagation(); setPopupOpen(false); }} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '12px 16px', textDecoration: 'none', color: C.white,
                  fontSize: 13, fontWeight: 500,
                }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
                  <span style={{ opacity: 0.6, display: 'flex' }}><SettingsIcon /></span>
                  Settings
                </Link>
                <div style={{ height: 1, background: 'rgba(255,255,255,0.07)', margin: '0 16px' }} />
                <button onClick={(e) => { e.stopPropagation(); setPopupOpen(false); void handleSignOut(); }} style={{
                  display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                  padding: '12px 16px', background: 'none', border: 'none', cursor: 'pointer',
                  color: '#F87171', fontSize: 13, fontWeight: 500, fontFamily: 'inherit', textAlign: 'left',
                }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(248,113,113,0.08)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
                  <span style={{ opacity: 0.8, display: 'flex' }}><LogOutIcon /></span>
                  Log Out
                </button>
              </div>
            </>
          )}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'space-between', gap: 8 }}>
            {/* Avatar */}
            <button
              onClick={(e) => { e.stopPropagation(); setPopupOpen((v) => !v); }}
              title={collapsed ? 'Account options' : undefined}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', flexShrink: 0 }}
            >
              <div style={{ width: 38, height: 38, borderRadius: 8, background: '#FCE8CA', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600, color: C.dark }}>{initials}</div>
            </button>

            {/* Name + email + dots — hidden when collapsed */}
            <div style={{
              display: 'flex', alignItems: 'center', flex: 1, minWidth: 0,
              maxWidth: collapsed ? 0 : 160,
              opacity: collapsed ? 0 : 1,
              overflow: 'hidden',
              transition: 'max-width .22s ease, opacity .18s ease',
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: C.white, fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName}</div>
                {email && <div style={{ color: '#EEEEEE', fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{email}</div>}
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); setPopupOpen((v) => !v); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: popupOpen ? C.white : '#888', flexShrink: 0, padding: 4 }}
                title="Account options"
              >
                <DotsIcon />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
