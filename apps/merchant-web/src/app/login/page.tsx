'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Eye, EyeOff, LockIcon, MailIcon } from '@/components/icons';
import { LogoAuth } from '@/components/logo';
import { C } from '@/components/tokens';
import { Divider } from '@/components/ui/divider';
import { GoogleBtn } from '@/components/ui/google-btn';
import { useToast } from '@/components/ui/toast';
import { initToken } from '@/lib/api';
import { errorBodyMessage } from '@/lib/errors';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

const fieldWrap: React.CSSProperties = {
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  background: C.field,
  border: `1px solid ${C.border}`,
  borderRadius: 8,
  height: 44,
};
const inputStyle: React.CSSProperties = {
  flex: 1,
  background: 'transparent',
  border: 'none',
  outline: 'none',
  fontFamily: 'inherit',
  fontSize: 14,
  color: C.text,
  paddingLeft: 36,
  paddingRight: 12,
};

// Reason codes on /login?error=: the Google callbacks, and the session gate in (app)/layout.
function loginErrorMessage(code: string | null): string {
  if (!code) return '';
  switch (code) {
    case 'not_a_merchant':
      return 'This Google account has no merchant access. Use the email and password you were given.';
    case 'no_access':
      return 'This account has no merchant access. Contact your admin.';
    case 'unreachable':
      return 'Unable to reach the server. Check your connection and try again.';
    case 'session_expired':
      return 'Your session has expired. Sign in again.';
    default:
      return "Google sign-in didn't go through. Please try again.";
  }
}

function ImagePanel() {
  return (
    <div
      className="auth-image-panel"
      style={{ width: '58.2%', flexShrink: 0, position: 'relative', overflow: 'hidden' }}
    >
      {/* biome-ignore lint/performance/noImgElement: auth background image */}
      <img
        src={`${BASE}/assets/auth-bg.png`}
        alt=""
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          objectPosition: 'top center',
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(to bottom, rgba(0,0,0,0) 60%, rgba(0,0,0,0.72) 100%)',
        }}
      />
      <div style={{ position: 'absolute', bottom: 40, left: 40, right: 40 }}>
        <h2
          style={{ fontWeight: 700, fontSize: 20, color: '#fff', marginBottom: 8, lineHeight: 1.4 }}
        >
          Run every branch from one place
        </h2>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)', lineHeight: 1.6, margin: 0 }}>
          Manage branches, staff and in-store tablets, keep your catalogue current, and see how each
          store performs.
        </p>
      </div>
    </div>
  );
}

function LoginFormInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();
  const queryError = loginErrorMessage(searchParams.get('error'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (queryError) toast.show(queryError);
  }, [queryError, toast]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const body = (await res.json().catch(() => null)) as { accessToken?: string } | null;
      if (!res.ok || !body?.accessToken) {
        toast.show(errorBodyMessage(body) ?? 'Unable to sign in. Try again.');
        return;
      }
      initToken(body.accessToken);
      router.push('/');
    } catch {
      toast.show('Unable to reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: `#000 url('${BASE}/assets/auth-screen-bg.png') center center / cover no-repeat`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 20px',
        boxSizing: 'border-box',
      }}
    >
      <div
        className="auth-card"
        style={{
          width: '100%',
          maxWidth: 1143,
          height: 'min(772px, 88vh)',
          background: C.card,
          borderRadius: 20,
          display: 'flex',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            flex: 1,
            padding: '48px 40px 48px 48px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            gap: 20,
            overflowY: 'auto',
          }}
        >
          <LogoAuth />
          <div>
            <h1 style={{ fontWeight: 700, fontSize: 22, color: C.text, marginBottom: 4 }}>
              Welcome Back
            </h1>
            <div style={{ fontSize: 14, color: C.mid }}>Sign in to AiVastra Merchant.</div>
          </div>

          <GoogleBtn label="Continue with Google" />
          <Divider label="Or Continue With" />

          <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label htmlFor="email" style={{ fontWeight: 700, fontSize: 14, color: C.text }}>
                Email*
              </label>
              <div style={fieldWrap}>
                <span style={{ position: 'absolute', left: 12, color: C.mid, display: 'flex' }}>
                  <MailIcon />
                </span>
                <input
                  id="email"
                  type="email"
                  required
                  placeholder="Enter your email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  style={inputStyle}
                />
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label htmlFor="password" style={{ fontWeight: 700, fontSize: 14, color: C.text }}>
                Password*
              </label>
              <div style={fieldWrap}>
                <span style={{ position: 'absolute', left: 12, color: C.mid, display: 'flex' }}>
                  <LockIcon />
                </span>
                <input
                  id="password"
                  type={showPwd ? 'text' : 'password'}
                  required
                  placeholder="Enter password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  style={{ ...inputStyle, paddingRight: 36 }}
                />
                <button
                  type="button"
                  aria-label={showPwd ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPwd((v) => !v)}
                  style={{
                    position: 'absolute',
                    right: 10,
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: C.mid,
                    display: 'flex',
                    padding: 0,
                  }}
                >
                  {showPwd ? <EyeOff /> : <Eye />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={busy}
              style={{
                width: '100%',
                height: 44,
                borderRadius: 8,
                border: 'none',
                cursor: 'pointer',
                background: C.dark,
                color: C.onDark,
                fontFamily: 'inherit',
                fontWeight: 600,
                fontSize: 14,
                opacity: busy ? 0.6 : 1,
              }}
            >
              {busy ? 'Signing in…' : 'Continue'}
            </button>
          </form>

          <p style={{ textAlign: 'center', fontSize: 12, color: C.light, margin: 0 }}>
            Staff sign in with the email and password your admin gave you.
          </p>
        </div>
        <ImagePanel />
      </div>
    </div>
  );
}

export default function LoginPage(): React.ReactElement {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', background: '#000' }} />}>
      <LoginFormInner />
    </Suspense>
  );
}
