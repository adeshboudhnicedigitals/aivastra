'use client';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { LoginBody } from '@aivastra/types';
import type { z } from 'zod';

type LoginForm = z.infer<typeof LoginBody>;

const inputStyle: React.CSSProperties = {
  display: 'block', width: '100%', height: 46, padding: '0 16px',
  background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 12,
  fontSize: 14, color: 'var(--ink)', fontFamily: 'inherit', outline: 'none',
  transition: 'border-color .15s, box-shadow .15s',
};

export default function LoginPage(): React.ReactElement {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get('next') ?? '/dashboard';
  const [error, setError] = useState('');

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginForm>({
    resolver: zodResolver(LoginBody),
  });

  async function onSubmit(data: LoginForm) {
    setError('');
    const res = await fetch('/api/auth/login', {
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
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 24px', background: 'var(--bg)' }}>
      <div style={{ width: '100%', maxWidth: 380 }}>
        {/* Brand */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ width: 48, height: 48, borderRadius: 14, background: 'linear-gradient(135deg,#F55C7A,#F6B553)', display: 'grid', placeItems: 'center', margin: '0 auto 16px', color: 'white', fontWeight: 800, fontSize: 20 }}>
            Av
          </div>
          <h1 style={{ fontWeight: 700, fontSize: 28, letterSpacing: '-0.02em', margin: '0 0 8px' }}>Welcome back</h1>
          <p style={{ fontSize: 14, color: 'var(--mute)', margin: 0 }}>Sign in to your Ai Vastra studio.</p>
        </div>

        {/* Card */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 20, padding: 28, boxShadow: 'var(--shadow-card)' }}>
          {/* Tab row */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
            <span style={{ padding: '6px 14px', borderRadius: 99, background: 'var(--ink)', color: 'var(--surface)', fontSize: 12, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase' }}>Login</span>
            <Link href="/register" style={{ padding: '6px 14px', borderRadius: 99, border: '1px solid var(--line)', color: 'var(--mute)', fontSize: 12, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', transition: 'all .15s' }}>Sign up</Link>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div className="av-field">
              <label className="av-field-label" htmlFor="email">Email</label>
              <input id="email" type="email" placeholder="you@brand.com" autoComplete="email" style={inputStyle} {...register('email')} />
              {errors.email && <p style={{ fontSize: 12, color: 'var(--peach)', margin: '4px 0 0' }}>{errors.email.message}</p>}
            </div>
            <div className="av-field">
              <label className="av-field-label" htmlFor="password">Password</label>
              <input id="password" type="password" autoComplete="current-password" style={inputStyle} {...register('password')} />
              {errors.password && <p style={{ fontSize: 12, color: 'var(--peach)', margin: '4px 0 0' }}>{errors.password.message}</p>}
            </div>
            {error && (
              <div style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid var(--peach)', background: 'rgba(245,92,122,0.06)', fontSize: 14, color: 'var(--peach)' }}>{error}</div>
            )}
            <button type="submit" disabled={isSubmitting} className="av-btn av-btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: 4 }}>
              {isSubmitting ? 'Signing in…' : 'Sign in →'}
            </button>
          </form>

          <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--mute)', marginTop: 20, marginBottom: 0 }}>
            New to Ai Vastra?{' '}
            <Link href="/register" style={{ color: 'var(--ink)', fontWeight: 600, textDecoration: 'underline', textUnderlineOffset: 2 }}>
              Create an account
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
