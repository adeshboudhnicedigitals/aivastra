'use client';
import { WidgetClientLogin } from '@aivastra/types';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { LockIcon, MailIcon } from '@/components/icons';
import { LogoAuth } from '@/components/logo';
import { C } from '@/components/tokens';

type LoginForm = z.infer<typeof WidgetClientLogin>;

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

function ImagePanel() {
  return (
    <div
      className="auth-image-panel"
      style={{ width: '58.2%', flexShrink: 0, position: 'relative', overflow: 'hidden' }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
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
          Power Your Store with Virtual Try-On
        </h2>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)', lineHeight: 1.6, margin: 0 }}>
          Let your customers see themselves in your garments before they buy — reduce returns, boost
          conversions.
        </p>
      </div>
    </div>
  );
}

export default function MerchantLoginPage() {
  const router = useRouter();
  const [error, setError] = useState('');

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({ resolver: zodResolver(WidgetClientLogin) });

  async function onSubmit(data: LoginForm) {
    setError('');
    const res = await fetch('/api/merchant/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const body = await res.json();
      setError(body.error?.message ?? 'Login failed');
      return;
    }
    router.push('/merchant/dashboard');
    router.refresh();
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#000',
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
            padding: '40px 48px',
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
              Merchant Login
            </h1>
            <p style={{ fontSize: 13, color: C.mid, margin: 0 }}>
              Sign in to your merchant account
            </p>
          </div>

          <form
            onSubmit={handleSubmit(onSubmit)}
            style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
          >
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
                  placeholder="Enter your email"
                  autoComplete="email"
                  style={inputStyle}
                  {...register('email')}
                />
              </div>
              {errors.email && (
                <p style={{ fontSize: 12, color: C.pink, margin: 0 }}>{errors.email.message}</p>
              )}
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
                  type="password"
                  placeholder="Enter password"
                  autoComplete="current-password"
                  style={inputStyle}
                  {...register('password')}
                />
              </div>
              {errors.password && (
                <p style={{ fontSize: 12, color: C.pink, margin: 0 }}>{errors.password.message}</p>
              )}
            </div>

            {error && (
              <div
                style={{
                  padding: '10px 14px',
                  borderRadius: 8,
                  border: `1px solid ${C.pink}`,
                  background: 'rgba(245,92,122,0.06)',
                  fontSize: 14,
                  color: C.pink,
                }}
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
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
                opacity: isSubmitting ? 0.6 : 1,
              }}
            >
              {isSubmitting ? 'Signing in…' : 'Sign In'}
            </button>
          </form>

          <p style={{ textAlign: 'center', fontSize: 12, color: C.light, margin: 0 }}>
            Don&apos;t have an account?{' '}
            <Link
              href="/merchant/signup"
              style={{ fontWeight: 700, fontSize: 12, color: C.pink, textDecoration: 'none' }}
            >
              Sign Up
            </Link>
          </p>
        </div>
        <ImagePanel />
      </div>
    </div>
  );
}
