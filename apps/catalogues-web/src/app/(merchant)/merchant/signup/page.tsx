'use client';
import { WidgetClientSignup } from '@aivastra/types';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { LogoAuth } from '@/components/logo';
import { C } from '@/components/tokens';

const SignupSchema = WidgetClientSignup.extend({
  confirm: z.string().min(1, 'Please confirm your password'),
  terms: z.literal(true, { errorMap: () => ({ message: 'You must agree to the terms' }) }),
}).refine((d) => d.password === d.confirm, {
  message: 'Passwords do not match',
  path: ['confirm'],
});

type FormValues = z.infer<typeof SignupSchema>;

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

const fieldStyle: React.CSSProperties = {
  width: '100%',
  height: 44,
  background: C.field,
  border: `1px solid ${C.border}`,
  borderRadius: 8,
  outline: 'none',
  fontFamily: 'inherit',
  fontSize: 14,
  color: C.text,
  padding: '0 12px',
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  fontWeight: 600,
  fontSize: 12,
  color: C.text,
  marginBottom: 4,
  display: 'block',
};

const errorStyle: React.CSSProperties = {
  fontSize: 11,
  color: C.pink,
  margin: '2px 0 0',
};

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
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
  id,
  value,
  onChange,
  options,
  placeholder,
  hasError,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
  placeholder: string;
  hasError?: boolean;
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

  const selectedLabel = options.find((o) => o.value === value)?.label;

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      <button
        id={id}
        type="button"
        onClick={() => setOpen((p) => !p)}
        style={{
          ...fieldStyle,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          border: hasError ? `1px solid ${C.pink}` : (fieldStyle.border as string),
          color: selectedLabel ? C.text : C.mid,
        }}
      >
        <span style={{ fontSize: 14 }}>{selectedLabel ?? placeholder}</span>
        <ChevronIcon open={open} />
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            background: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: 10,
            zIndex: 100,
            overflow: 'hidden',
            boxShadow: '0 8px 32px rgba(0,0,0,0.16)',
          }}
        >
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                width: '100%',
                padding: '10px 14px',
                background: value === opt.value ? C.field : 'transparent',
                border: 'none',
                fontFamily: 'inherit',
                fontSize: 14,
                color: value === opt.value ? C.pink : C.text,
                fontWeight: value === opt.value ? 600 : 400,
                cursor: 'pointer',
                textAlign: 'left',
                gap: 8,
              }}
            >
              {value === opt.value && (
                <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path
                    d="M2 7l4 4 6-6"
                    stroke={C.pink}
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
              {value !== opt.value && <span style={{ width: 14 }} />}
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ImagePanel() {
  return (
    <div
      className="auth-image-panel"
      style={{ width: '58.2%', flexShrink: 0, position: 'relative', overflow: 'hidden' }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {/* biome-ignore lint/performance/noImgElement: merchant signup auth background image */}
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
          Offer Virtual Try-On to Your Customers
        </h2>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)', lineHeight: 1.6, margin: 0 }}>
          Let your customers see how they look in your garments before they buy — reduce returns,
          boost conversions.
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
      router.push('/merchant/login');
      return;
    }

    router.push('/merchant/dashboard');
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
          height: 'min(820px, 92vh)',
          background: C.card,
          borderRadius: 20,
          display: 'flex',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            flex: 1,
            paddingLeft: 48,
            paddingRight: 40,
            paddingTop: 36,
            paddingBottom: 36,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-start',
            gap: 14,
            overflowY: 'auto',
          }}
        >
          <LogoAuth />
          <div>
            <h1 style={{ fontWeight: 700, fontSize: 22, color: C.text, marginBottom: 4 }}>
              Merchant Sign Up
            </h1>
            <p style={{ fontSize: 13, color: C.mid, margin: 0 }}>
              Get your widget key to embed on your site
            </p>
          </div>

          <form
            onSubmit={handleSubmit(onSubmit)}
            style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
          >
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label htmlFor="signup-companyName" style={labelStyle}>
                  Company Name*
                </label>
                <input
                  id="signup-companyName"
                  style={fieldStyle}
                  placeholder="Your company"
                  {...register('companyName')}
                />
                {errors.companyName && <p style={errorStyle}>{errors.companyName.message}</p>}
              </div>
              <div>
                <label htmlFor="signup-contactName" style={labelStyle}>
                  Your Name*
                </label>
                <input
                  id="signup-contactName"
                  style={fieldStyle}
                  placeholder="Full name"
                  {...register('contactName')}
                />
                {errors.contactName && <p style={errorStyle}>{errors.contactName.message}</p>}
              </div>
            </div>

            <div>
              <label htmlFor="signup-email" style={labelStyle}>
                Email Address*
              </label>
              <input
                id="signup-email"
                style={fieldStyle}
                type="email"
                placeholder="you@company.com"
                {...register('email')}
              />
              {errors.email && <p style={errorStyle}>{errors.email.message}</p>}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label htmlFor="signup-phone" style={labelStyle}>
                  Phone Number*
                </label>
                <input
                  id="signup-phone"
                  style={fieldStyle}
                  placeholder="+91 99999 99999"
                  {...register('phone')}
                />
                {errors.phone && <p style={errorStyle}>{errors.phone.message}</p>}
              </div>
              <div>
                <label htmlFor="signup-websiteUrl" style={labelStyle}>
                  Website URL*
                </label>
                <input
                  id="signup-websiteUrl"
                  style={fieldStyle}
                  placeholder="https://yourstore.com"
                  {...register('websiteUrl')}
                />
                {errors.websiteUrl && <p style={errorStyle}>{errors.websiteUrl.message}</p>}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label htmlFor="signup-companySize" style={labelStyle}>
                  Company Size*
                </label>
                <Controller
                  name="companySize"
                  control={control}
                  render={({ field }) => (
                    <CustomSelect
                      id="signup-companySize"
                      value={field.value ?? ''}
                      onChange={field.onChange}
                      options={COMPANY_SIZE_OPTIONS}
                      placeholder="Select size"
                      hasError={!!errors.companySize}
                    />
                  )}
                />
                {errors.companySize && <p style={errorStyle}>{errors.companySize.message}</p>}
              </div>
              <div>
                <label htmlFor="signup-purpose" style={labelStyle}>
                  Purpose*
                </label>
                <Controller
                  name="purpose"
                  control={control}
                  render={({ field }) => (
                    <CustomSelect
                      id="signup-purpose"
                      value={field.value ?? ''}
                      onChange={field.onChange}
                      options={PURPOSE_OPTIONS}
                      placeholder="Select purpose"
                      hasError={!!errors.purpose}
                    />
                  )}
                />
                {errors.purpose && <p style={errorStyle}>{errors.purpose.message}</p>}
              </div>
            </div>

            <div>
              <label htmlFor="signup-businessAddress" style={labelStyle}>
                Business Address*
              </label>
              <input
                id="signup-businessAddress"
                style={fieldStyle}
                placeholder="Full address"
                {...register('businessAddress')}
              />
              {errors.businessAddress && <p style={errorStyle}>{errors.businessAddress.message}</p>}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label htmlFor="signup-password" style={labelStyle}>
                  Password*
                </label>
                <input
                  id="signup-password"
                  style={fieldStyle}
                  type="password"
                  placeholder="Min 8 characters"
                  {...register('password')}
                />
                {errors.password && <p style={errorStyle}>{errors.password.message}</p>}
              </div>
              <div>
                <label htmlFor="signup-confirm" style={labelStyle}>
                  Confirm Password*
                </label>
                <input
                  id="signup-confirm"
                  style={fieldStyle}
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
                fontSize: 12,
                color: C.mid,
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                {...register('terms')}
                style={{ width: 16, height: 16, accentColor: C.pink }}
              />
              I agree to the Terms &amp; Privacy Policy
            </label>
            {errors.terms && <p style={errorStyle}>{errors.terms.message}</p>}

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
              {isSubmitting ? 'Creating account…' : 'Create Merchant Account'}
            </button>
          </form>

          <p style={{ textAlign: 'center', fontSize: 12, color: C.light, margin: 0 }}>
            Already have an account?{' '}
            <Link
              href="/merchant/login"
              style={{ fontWeight: 700, fontSize: 12, color: C.pink, textDecoration: 'none' }}
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
