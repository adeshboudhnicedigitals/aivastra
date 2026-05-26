'use client';
import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { LoginBody } from '@aivastra/types';
import type { z } from 'zod';

type LoginForm = z.infer<typeof LoginBody>;

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

const MailIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
    <path d="M22 6l-10 7L2 6"/>
  </svg>
);
const LockIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
    <path d="M7 11V7a5 5 0 0110 0v4"/>
  </svg>
);
const GiftIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 12v10H4V12"/><path d="M22 7H2v5h20V7z"/><path d="M12 22V7"/>
    <path d="M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7z"/>
    <path d="M12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z"/>
  </svg>
);

const inputStyle: React.CSSProperties = {
  display: 'block', width: '100%', height: 44,
  padding: '0 16px 0 36px',
  background: '#F9F9F9', border: '1px solid #EEEEEE', borderRadius: 8,
  fontSize: 14, color: '#141414', fontFamily: 'inherit', outline: 'none',
  boxSizing: 'border-box',
};

function FieldWithIcon({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
      <span style={{ position: 'absolute', left: 12, color: '#626262', display: 'flex', pointerEvents: 'none' }}>{icon}</span>
      {children}
    </div>
  );
}

function LoginFormInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get('next') ?? '/tryon';
  const [error, setError] = useState('');

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginForm>({
    resolver: zodResolver(LoginBody),
  });

  async function onSubmit(data: LoginForm) {
    setError('');
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const body = await res.json() as { error?: { message?: string } };
      setError(body.error?.message ?? 'Login failed');
      return;
    }
    router.push(nextPath);
    router.refresh();
  }

  return (
    <div className="av-auth-shell">
      {/* Left — form */}
      <div className="av-auth-form-col">
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`${BASE}/assets/logo-icon-large.png`} alt="" style={{ height: 36, width: 'auto' }} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`${BASE}/assets/logo-wordmark-large.png`} alt="Ai Vastra" style={{ height: 30, width: 'auto' }} />
        </div>

        <div>
          <h1 style={{ fontWeight: 700, fontSize: 22, color: '#141414', marginBottom: 4 }}>Welcome Back</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, color: '#626262' }}>
            <GiftIcon /> <span>Get 100 Free credits to start.</span>
          </div>
        </div>

        {/* Google button (UI only) */}
        <button type="button" style={{
          width: '100%', height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          background: '#FEFEFE', border: '1px solid #E8E8E8', borderRadius: 8, cursor: 'pointer',
          fontFamily: 'inherit', fontWeight: 500, fontSize: 14, color: '#141414',
        }}>
          <svg width="18" height="18" viewBox="0 0 48 48">
            <path fill="#EA4335" d="M24 9.5c3.5 0 6.3 1.2 8.4 3.2l6.3-6.3C34.9 2.7 29.8.5 24 .5 14.8.5 7 6.1 3.3 14l7.4 5.7C12.5 13.4 17.8 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.7c-.6 3-2.3 5.4-4.8 7.1l7.4 5.7c4.3-4 6.8-9.8 7.2-16.8z"/>
            <path fill="#FBBC05" d="M10.7 28.3A14.9 14.9 0 019.5 24c0-1.5.3-3 .7-4.3L2.8 14C1 17.1 0 20.4 0 24s1 6.9 2.8 10l7.9-5.7z"/>
            <path fill="#34A853" d="M24 47.5c5.8 0 10.7-1.9 14.3-5.1l-7.4-5.7c-2 1.3-4.4 2.1-6.9 2.1-6.2 0-11.5-4-13.3-9.5l-7.4 5.7C7 41.9 14.8 47.5 24 47.5z"/>
          </svg>
          Continue with Google
        </button>

        <div className="av-auth-divider">Or Continue With</div>

        <form onSubmit={handleSubmit(onSubmit)} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="av-field">
            <label className="av-field-label" htmlFor="email">Email*</label>
            <FieldWithIcon icon={<MailIcon />}>
              <input id="email" type="email" placeholder="Enter your email" autoComplete="email" style={inputStyle} {...register('email')} />
            </FieldWithIcon>
            {errors.email && <p style={{ fontSize: 12, color: 'var(--peach)', margin: '4px 0 0' }}>{errors.email.message}</p>}
          </div>
          <div className="av-field">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <label className="av-field-label" htmlFor="password" style={{ marginBottom: 0 }}>Password*</label>
              <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: '#141414', fontWeight: 500 }}>Reset Password</button>
            </div>
            <FieldWithIcon icon={<LockIcon />}>
              <input id="password" type="password" placeholder="Enter password" autoComplete="current-password" style={inputStyle} {...register('password')} />
            </FieldWithIcon>
            {errors.password && <p style={{ fontSize: 12, color: 'var(--peach)', margin: '4px 0 0' }}>{errors.password.message}</p>}
          </div>
          {error && (
            <div style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid var(--peach)', background: 'rgba(245,92,122,0.06)', fontSize: 14, color: 'var(--peach)' }}>{error}</div>
          )}
          <button type="submit" disabled={isSubmitting} className="av-btn-dark" style={{ marginTop: 4 }}>
            {isSubmitting ? 'Signing in…' : 'Continue'}
          </button>
        </form>

        <p style={{ textAlign: 'center', fontSize: 12, color: '#939393' }}>
          Don&apos;t have an account?{' '}
          <Link href="/register" style={{ fontWeight: 700, fontSize: 12, color: 'var(--peach)', textDecoration: 'none' }}>Sign Up</Link>
        </p>
      </div>

      {/* Right — image */}
      <div className="av-auth-image-col">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`${BASE}/assets/auth-bg.png`} alt="" />
        <div className="av-auth-image-overlay" />
        <div className="av-auth-image-caption">
          <h2 style={{ fontWeight: 700, fontSize: 20, color: '#FEFEFE', marginBottom: 8, lineHeight: 1.4 }}>
            Turn Flat Lay Images Into Premium Model Shoots
          </h2>
          <p style={{ fontSize: 13, color: '#EEEEEE', lineHeight: 1.6, margin: 0 }}>
            Generate realistic AI catalogue photos with premium models, luxury backgrounds, and ecommerce-ready poses.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage(): React.ReactElement {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', background: '#FEFEFE' }} />}>
      <LoginFormInner />
    </Suspense>
  );
}
