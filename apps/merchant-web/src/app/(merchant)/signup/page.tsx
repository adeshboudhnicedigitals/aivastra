'use client';
import { MerchantSignup } from '@aivastra/types';
import { zodResolver } from '@hookform/resolvers/zod';
import { Check } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { LogoAuth } from '@/components/logo';

const SignupSchema = MerchantSignup.extend({
  confirm: z.string().min(1, 'Please confirm your password'),
  terms: z.literal(true, { errorMap: () => ({ message: 'You must agree to the terms' }) }),
}).refine((d) => d.password === d.confirm, {
  message: 'Passwords do not match',
  path: ['confirm'],
});

type FormValues = z.infer<typeof SignupSchema>;

const fieldStyle: React.CSSProperties = {
  width: '100%',
  height: 44,
  background: 'hsl(var(--bg-base))',
  border: '1px solid hsl(var(--border-strong))',
  borderRadius: 'var(--radius-md)',
  outline: 'none',
  fontFamily: 'inherit',
  fontSize: '0.875rem',
  color: 'hsl(var(--text-primary))',
  padding: '0 var(--space-3)',
  boxSizing: 'border-box',
  transition: 'border-color var(--transition-fast), box-shadow var(--transition-fast)',
};

const labelStyle: React.CSSProperties = {
  fontWeight: 600,
  fontSize: '0.875rem',
  color: 'hsl(var(--text-primary))',
  marginBottom: 'var(--space-1)',
  display: 'block',
};

const errorStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  color: 'hsl(var(--danger-base))',
  margin: '4px 0 0',
};

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      style={{
        flexShrink: 0,
        transition: 'transform 0.15s',
        transform: open ? 'rotate(180deg)' : 'none',
      }}
    >
      <path
        d="M4 6l4 4 4-4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface SelectOption {
  value: string;
  label: string;
}

function CustomSelect({
  value,
  onChange,
  options,
  placeholder,
  hasError,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
  placeholder: string;
  hasError?: boolean;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [open]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      setOpen(false);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setOpen((p) => !p);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
      } else {
        const currIdx = options.findIndex((o) => o.value === value);
        const nextIdx =
          e.key === 'ArrowDown'
            ? Math.min(currIdx + 1, options.length - 1)
            : Math.max(currIdx - 1, 0);
        if (options[nextIdx]) {
          onChange(options[nextIdx].value);
        }
      }
    }
  }

  const selectedLabel = options.find((o) => o.value === value)?.label;

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      <button
        id={id}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((p) => !p)}
        onKeyDown={handleKeyDown}
        style={{
          ...fieldStyle,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          borderColor: hasError ? 'hsl(var(--danger-base))' : 'hsl(var(--border-strong))',
          color: selectedLabel ? 'hsl(var(--text-primary))' : 'hsl(var(--text-tertiary))',
        }}
      >
        <span>{selectedLabel ?? placeholder}</span>
        <ChevronIcon open={open} />
      </button>

      {open && (
        <div
          role="listbox"
          className="animate-slide-up"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            background: 'hsl(var(--bg-base))',
            border: '1px solid hsl(var(--border-default))',
            borderRadius: 'var(--radius-md)',
            zIndex: 100,
            overflow: 'hidden',
            boxShadow: 'var(--shadow-md)',
          }}
        >
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="option"
              aria-selected={value === opt.value}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                width: '100%',
                padding: '10px 14px',
                background: value === opt.value ? 'hsl(var(--bg-surface-hover))' : 'transparent',
                border: 'none',
                fontFamily: 'inherit',
                fontSize: '0.875rem',
                color:
                  value === opt.value ? 'hsl(var(--accent-primary))' : 'hsl(var(--text-primary))',
                fontWeight: value === opt.value ? 600 : 400,
                cursor: 'pointer',
                textAlign: 'left',
                gap: 8,
              }}
            >
              {value === opt.value && <Check size={14} color="hsl(var(--accent-primary))" />}
              <span>{opt.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

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
          Offer Virtual Try-On to Your Customers
        </h2>
        <p
          style={{ fontSize: '1rem', color: 'rgba(255,255,255,0.85)', lineHeight: 1.6, margin: 0 }}
        >
          Let your customers see how they look in your garments before they buy &mdash; reduce
          returns, boost conversions.
        </p>
      </div>
    </div>
  );
}

const COMPANY_SIZE_OPTIONS: SelectOption[] = [
  { value: '1-10', label: '1–10 employees' },
  { value: '11-50', label: '11–50 employees' },
  { value: '51-200', label: '51–200 employees' },
  { value: '200+', label: '200+ employees' },
];

const PURPOSE_OPTIONS: SelectOption[] = [
  { value: 'ecommerce', label: 'E-commerce' },
  { value: 'fashion_brand', label: 'Fashion Brand' },
  { value: 'tailoring', label: 'Tailoring' },
  { value: 'marketplace', label: 'Marketplace' },
  { value: 'enterprise', label: 'Enterprise' },
];

export default function MerchantSignupPage() {
  const router = useRouter();
  const [error, setError] = useState('');

  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(SignupSchema) });

  async function onSubmit(data: FormValues) {
    setError('');
    const { confirm: _, terms: __, ...body } = data;

    const res = await fetch('/api/merchant/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json();
      setError(err.error?.message ?? 'Registration failed');
      return;
    }

    const loginRes = await fetch('/api/merchant/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: body.email, password: body.password }),
    });
    if (!loginRes.ok) {
      router.push('/login');
      return;
    }

    router.push('/dashboard');
  }

  return (
    <div className="auth-container">
      <div className="auth-card-wrapper" style={{ height: 'min(820px, 92vh)' }}>
        <div
          style={{
            flex: 1,
            padding: 'var(--space-10) var(--space-12)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-start',
            gap: 'var(--space-4)',
            overflowY: 'auto',
          }}
        >
          <div style={{ marginBottom: 'var(--space-2)' }}>
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
              Merchant Sign Up
            </h1>
            <p style={{ fontSize: '0.875rem', color: 'hsl(var(--text-secondary))', margin: 0 }}>
              Get your widget key to embed on your site
            </p>
          </div>

          <form
            onSubmit={handleSubmit(onSubmit)}
            style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}
          >
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
              <div>
                <label htmlFor="companyName" style={labelStyle}>
                  Company Name
                </label>
                <input
                  id="companyName"
                  style={{
                    ...fieldStyle,
                    borderColor: errors.companyName ? 'hsl(var(--danger-base))' : undefined,
                  }}
                  placeholder="Your company"
                  {...register('companyName')}
                />
                {errors.companyName && <p style={errorStyle}>{errors.companyName.message}</p>}
              </div>
              <div>
                <label htmlFor="contactName" style={labelStyle}>
                  Your Name
                </label>
                <input
                  id="contactName"
                  style={{
                    ...fieldStyle,
                    borderColor: errors.contactName ? 'hsl(var(--danger-base))' : undefined,
                  }}
                  placeholder="Full name"
                  {...register('contactName')}
                />
                {errors.contactName && <p style={errorStyle}>{errors.contactName.message}</p>}
              </div>
            </div>

            <div>
              <label htmlFor="email" style={labelStyle}>
                Email Address
              </label>
              <input
                id="email"
                style={{
                  ...fieldStyle,
                  borderColor: errors.email ? 'hsl(var(--danger-base))' : undefined,
                }}
                type="email"
                placeholder="you@company.com"
                {...register('email')}
              />
              {errors.email && <p style={errorStyle}>{errors.email.message}</p>}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
              <div>
                <label htmlFor="phone" style={labelStyle}>
                  Phone Number
                </label>
                <input
                  id="phone"
                  style={{
                    ...fieldStyle,
                    borderColor: errors.phone ? 'hsl(var(--danger-base))' : undefined,
                  }}
                  placeholder="+91 99999 99999"
                  {...register('phone')}
                />
                {errors.phone && <p style={errorStyle}>{errors.phone.message}</p>}
              </div>
              <div>
                <label htmlFor="websiteUrl" style={labelStyle}>
                  Website URL
                </label>
                <input
                  id="websiteUrl"
                  style={{
                    ...fieldStyle,
                    borderColor: errors.websiteUrl ? 'hsl(var(--danger-base))' : undefined,
                  }}
                  placeholder="https://yourstore.com"
                  {...register('websiteUrl')}
                />
                {errors.websiteUrl && <p style={errorStyle}>{errors.websiteUrl.message}</p>}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
              <div>
                <label htmlFor="companySize" style={labelStyle}>
                  Company Size
                </label>
                <Controller
                  name="companySize"
                  control={control}
                  render={({ field }) => (
                    <CustomSelect
                      value={field.value ?? ''}
                      onChange={field.onChange}
                      options={COMPANY_SIZE_OPTIONS}
                      placeholder="Select size"
                      hasError={!!errors.companySize}
                      id="companySize"
                    />
                  )}
                />
                {errors.companySize && <p style={errorStyle}>{errors.companySize.message}</p>}
              </div>
              <div>
                <label htmlFor="purpose" style={labelStyle}>
                  Purpose
                </label>
                <Controller
                  name="purpose"
                  control={control}
                  render={({ field }) => (
                    <CustomSelect
                      value={field.value ?? ''}
                      onChange={field.onChange}
                      options={PURPOSE_OPTIONS}
                      placeholder="Select purpose"
                      hasError={!!errors.purpose}
                      id="purpose"
                    />
                  )}
                />
                {errors.purpose && <p style={errorStyle}>{errors.purpose.message}</p>}
              </div>
            </div>

            <div>
              <label htmlFor="businessAddress" style={labelStyle}>
                Business Address
              </label>
              <input
                id="businessAddress"
                style={{
                  ...fieldStyle,
                  borderColor: errors.businessAddress ? 'hsl(var(--danger-base))' : undefined,
                }}
                placeholder="Full address"
                {...register('businessAddress')}
              />
              {errors.businessAddress && <p style={errorStyle}>{errors.businessAddress.message}</p>}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
              <div>
                <label htmlFor="password" style={labelStyle}>
                  Password
                </label>
                <input
                  id="password"
                  style={{
                    ...fieldStyle,
                    borderColor: errors.password ? 'hsl(var(--danger-base))' : undefined,
                  }}
                  type="password"
                  placeholder="Min 8 characters"
                  {...register('password')}
                />
                {errors.password && <p style={errorStyle}>{errors.password.message}</p>}
              </div>
              <div>
                <label htmlFor="confirm" style={labelStyle}>
                  Confirm Password
                </label>
                <input
                  id="confirm"
                  style={{
                    ...fieldStyle,
                    borderColor: errors.confirm ? 'hsl(var(--danger-base))' : undefined,
                  }}
                  type="password"
                  placeholder="Re-enter password"
                  {...register('confirm')}
                />
                {errors.confirm && <p style={errorStyle}>{errors.confirm.message}</p>}
              </div>
            </div>

            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: '0.875rem',
                color: 'hsl(var(--text-secondary))',
                cursor: 'pointer',
                marginTop: 'var(--space-1)',
              }}
            >
              <input
                type="checkbox"
                {...register('terms')}
                style={{ width: 16, height: 16, accentColor: 'hsl(var(--accent-primary))' }}
              />
              I agree to the Terms & Privacy Policy
            </label>
            {errors.terms && <p style={errorStyle}>{errors.terms.message}</p>}

            {error && (
              <div
                style={{
                  padding: 'var(--space-3) var(--space-4)',
                  borderRadius: 'var(--radius-md)',
                  background: 'hsl(var(--danger-subtle))',
                  fontSize: '0.875rem',
                  color: 'hsl(var(--danger-base))',
                  fontWeight: 500,
                  marginTop: 'var(--space-1)',
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
              {isSubmitting ? 'Creating account...' : 'Create Merchant Account'}
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
            Already have an account?{' '}
            <Link
              href="/login"
              style={{
                fontWeight: 600,
                color: 'hsl(var(--accent-primary))',
                textDecoration: 'none',
              }}
            >
              Sign In
            </Link>
          </p>
        </div>
        <ImagePanel />
      </div>
    </div>
  );
}
