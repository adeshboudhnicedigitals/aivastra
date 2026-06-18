'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { api } from '@/lib/api';
import { LogOutIcon, SettingsIcon } from './icons';
import { C } from './tokens';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface CreditsResponse {
  balance: number;
}
interface MeResponse {
  email: string;
  displayName: string | null;
}

export function UserMenu() {
  const router = useRouter();
  const [popupOpen, setPopupOpen] = useState(false);
  const [popupRect, setPopupRect] = useState<{ bottom: number; right: number } | null>(null);
  const [profileHover, setProfileHover] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);

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
  const email = me?.email ?? '';
  const displayName = me?.displayName ?? email.split('@')[0] ?? 'User';
  const initials = displayName.slice(0, 2).toUpperCase() || 'U';

  async function handleSignOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <Link
        href="/pricing"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          textDecoration: 'none',
          padding: '7px 14px',
          borderRadius: 8,
          background: C.bg,
          border: `1px solid ${C.border}`,
        }}
      >
        <span style={{ display: 'flex' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`${BASE}/assets/credit.png`} alt="" width={16} height={16} />
        </span>
        <span style={{ color: C.text, fontSize: 13, fontWeight: 500 }}>{balance} Credits</span>
      </Link>

      <div ref={popupRef} style={{ position: 'relative' }}>
        {popupOpen && (
          <>
            <div
              onClick={(e) => {
                e.stopPropagation();
                setPopupOpen(false);
              }}
              style={{ position: 'fixed', inset: 0, zIndex: 99 }}
            />
            <div
              style={{
                position: 'fixed',
                top: popupRect ? popupRect.bottom + 8 : 80,
                right: popupRect ? popupRect.right : 10,
                width: 240,
                background: '#1E1E1E',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 10,
                overflow: 'hidden',
                zIndex: 100,
                boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
              }}
            >
              <Link
                href="/settings"
                onClick={(e) => {
                  e.stopPropagation();
                  setPopupOpen(false);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '12px 16px',
                  textDecoration: 'none',
                  color: C.onDark,
                  fontSize: 13,
                  fontWeight: 500,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                <span style={{ opacity: 0.6, display: 'flex' }}>
                  <SettingsIcon />
                </span>
                Settings
              </Link>
              <div style={{ height: 1, background: 'rgba(255,255,255,0.07)', margin: '0 16px' }} />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setPopupOpen(false);
                  void handleSignOut();
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  width: '100%',
                  padding: '12px 16px',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#F87171',
                  fontSize: 13,
                  fontWeight: 500,
                  fontFamily: 'inherit',
                  textAlign: 'left',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(248,113,113,0.08)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                <span style={{ opacity: 0.8, display: 'flex' }}>
                  <LogOutIcon />
                </span>
                Log Out
              </button>
            </div>
          </>
        )}

        <button
          onClick={(e) => {
            e.stopPropagation();
            if (!popupOpen && popupRef.current) {
              const r = popupRef.current.getBoundingClientRect();
              setPopupRect({ bottom: r.bottom, right: window.innerWidth - r.right });
            }
            setPopupOpen((v) => !v);
          }}
          title={displayName}
          onMouseEnter={() => setProfileHover(true)}
          onMouseLeave={() => setProfileHover(false)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: popupOpen || profileHover ? C.bg : 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
            borderRadius: 8,
          }}
        >
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: 8,
              background: '#FCE8CA',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 13,
              fontWeight: 600,
              color: C.dark,
              flexShrink: 0,
            }}
          >
            {initials}
          </div>
        </button>
      </div>
    </div>
  );
}
