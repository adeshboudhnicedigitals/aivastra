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

type LoginForm = z.infer<typeof WidgetClientLogin>;

const fieldWrap: React.CSSProperties = {
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  background: 'hsl(var(--bg-base))',
  border: '1px solid hsl(var(--border-strong))',
  borderRadius: 'var(--radius-md)',
  height: 44,
  transition: 'border-color var(--transition-fast), box-shadow var(--transition-fast)',
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  background: 'transparent',
  border: 'none',
  outline: 'none',
  fontFamily: 'inherit',
  fontSize: '0.875rem',
  color: 'hsl(var(--text-primary))',
  paddingLeft: 40,
  paddingRight: 'var(--space-3)',
  width: '100%',
};

function ImagePanel() {
  return (
    <div className="auth-image-panel">
      {/* biome-ignore lint/performance/noImgElement: static asset */}
      <img
        src={`/assets/auth-bg.png`}
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
          background: 'linear-gradient(to bottom, rgba(0,0,0,0) 40%, rgba(0,0,0,0.8) 100%)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: 'var(--space-10)',
          left: 'var(--space-10)',
          right: 'var(--space-10)',
        }}
      >
        <h2
          style={{
            fontWeight: 700,
            fontSize: '1.75rem',
            color: '#fff',
            marginBottom: 'var(--space-2)',
            lineHeight: 1.3,
            letterSpacing: '-0.02em',
          }}
        >
          Power Your Store with Virtual Try-On
        </h2>
        <p
          style={{ fontSize: '1rem', color: 'rgba(255,255,255,0.85)', lineHeight: 1.6, margin: 0 }}
        >
          Let your customers see themselves in your garments before they buy &mdash; reduce returns,
          boost conversions.
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
    router.push('/dashboard');
    router.refresh();
  }

  return (
    <div className="auth-container">
      <div className="auth-card-wrapper" style={{ height: 'min(750px, 85vh)' }}>
        <div
          style={{
            flex: 1,
            padding: 'var(--space-10) var(--space-12)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            gap: 'var(--space-6)',
            overflowY: 'auto',
          }}
        >
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <LogoAuth />
          </div>
          <div>
            <h1
              style={{
                fontWeight: 700,
                fontSize: '1.75rem',
                color: 'hsl(var(--text-primary))',
                marginBottom: 'var(--space-1)',
                letterSpacing: '-0.02em',
              }}
            >
              Merchant Login
            </h1>
            <p style={{ fontSize: '0.875rem', color: 'hsl(var(--text-secondary))', margin: 0 }}>
              Sign in to your merchant account
            </p>
          </div>

          <form
            onSubmit={handleSubmit(onSubmit)}
            style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
              <label
                htmlFor="email"
                style={{ fontWeight: 600, fontSize: '0.875rem', color: 'hsl(var(--text-primary))' }}
              >
                Email
              </label>
              <div
                style={{
                  ...fieldWrap,
                  borderColor: errors.email
                    ? 'hsl(var(--danger-base))'
                    : 'hsl(var(--border-strong))',
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    left: 14,
                    color: 'hsl(var(--text-tertiary))',
                    display: 'flex',
                  }}
                >
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
                <p
                  style={{
                    fontSize: '0.75rem',
                    color: 'hsl(var(--danger-base))',
                    margin: 0,
                    marginTop: 4,
                  }}
                >
                  {errors.email.message}
                </p>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
              <label
                htmlFor="password"
                style={{ fontWeight: 600, fontSize: '0.875rem', color: 'hsl(var(--text-primary))' }}
              >
                Password
              </label>
              <div
                style={{
                  ...fieldWrap,
                  borderColor: errors.password
                    ? 'hsl(var(--danger-base))'
                    : 'hsl(var(--border-strong))',
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    left: 14,
                    color: 'hsl(var(--text-tertiary))',
                    display: 'flex',
                  }}
                >
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
                <p
                  style={{
                    fontSize: '0.75rem',
                    color: 'hsl(var(--danger-base))',
                    margin: 0,
                    marginTop: 4,
                  }}
                >
                  {errors.password.message}
                </p>
              )}
            </div>

            {error && (
              <div
                style={{
                  padding: 'var(--space-3) var(--space-4)',
                  borderRadius: 'var(--radius-md)',
                  background: 'hsl(var(--danger-subtle))',
                  fontSize: '0.875rem',
                  color: 'hsl(var(--danger-base))',
                  fontWeight: 500,
                }}
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="btn btn-primary"
              style={{
                width: '100%',
                height: 44,
                marginTop: 'var(--space-2)',
                opacity: isSubmitting ? 0.7 : 1,
              }}
            >
              {isSubmitting ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          <p
            style={{
              textAlign: 'center',
              fontSize: '0.875rem',
              color: 'hsl(var(--text-secondary))',
              margin: 0,
              marginTop: 'var(--space-2)',
            }}
          >
            Don't have an account?{' '}
            <Link
              href="/signup"
              style={{
                fontWeight: 600,
                color: 'hsl(var(--accent-primary))',
                textDecoration: 'none',
              }}
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
