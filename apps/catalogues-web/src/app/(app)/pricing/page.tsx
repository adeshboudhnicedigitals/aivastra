'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  BarChart2,
  Building2,
  Image,
  ImagePlus,
  Info,
  Rocket,
  Shirt,
} from 'lucide-react';

import { useRouter } from 'next/navigation';
import { Fragment, useEffect, useRef, useState } from 'react';
import {
  CheckIcon,
  ChevronDown,
  ChevronRight,
  FlagAE,
  FlagGB,
  FlagIN,
  FlagUS,
} from '@/components/icons';
import { SupportModal } from '@/components/SupportModal';
import { C, grad } from '@/components/tokens';
import { TopBar } from '@/components/topbar';
import { Tooltip } from '@/components/ui/tooltip';
import { api } from '@/lib/api';

interface CreditPlan {
  id: string;
  slug: string;
  name: string;
  subtext: string;
  credits: number;
  basePaise: number;
  isActive: boolean;
  isHighlighted: boolean;
  badge: string | null;
  sortOrder: number;
}

const FLAGS: Record<string, React.ReactElement> = {
  IN: <FlagIN size={16} />,
  US: <FlagUS size={16} />,
  GB: <FlagGB size={16} />,
  AE: <FlagAE size={16} />,
};

const GST_RATE = 0.18;

interface ResolutionConfig {
  enabled: boolean;
  creditCost: number;
}
interface ResolutionConfigs {
  HD?: ResolutionConfig;
  '2K'?: ResolutionConfig;
  '4K'?: ResolutionConfig;
}

const CURRENCY: Record<string, { code: string; locale: string }> = {
  IN: { code: 'INR', locale: 'en-IN' },
  US: { code: 'USD', locale: 'en-US' },
  GB: { code: 'GBP', locale: 'en-GB' },
  AE: { code: 'AED', locale: 'en-AE' },
};

const FALLBACK_RATES: Record<string, number> = {
  IN: 1,
  US: 0.012,
  GB: 0.0095,
  AE: 0.044,
};

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

// Per-plan metadata — index matches sortOrder (0=Starter, 1=Growth, 2=Business)
const PLAN_META = [
  {
    Icon: Rocket,
    subtext: 'Perfect for Small Businesses',
    accent: C.mid,
    iconColor: C.text,
    iconSrc: undefined,
    iconBg: C.mid,
    checkGrad: false,
    icon2k: `${BASE}/assets/2k-b-vec.svg`,
    icon4k: `${BASE}/assets/4k-b-vec.svg`,
    invertUsage: true,
  },
  {
    Icon: BarChart2,
    subtext: 'Best for Growing Businesses',
    accent: C.mint,
    iconColor: undefined,
    iconSrc: `${BASE}/assets/gro-vec.svg`,
    iconBg: C.mid,
    checkGrad: true,
    icon2k: `${BASE}/assets/2k-vec.svg`,
    icon4k: `${BASE}/assets/4k-vec.svg`,
    invertUsage: false,
  },
  {
    Icon: Building2,
    subtext: 'Ideal for Large Businesses',
    accent: C.mid,
    iconColor: C.text,
    iconSrc: `${BASE}/assets/pro-vec.svg`,
    iconBg: C.mid,
    checkGrad: false,
    icon2k: `${BASE}/assets/2k-b-vec.svg`,
    icon4k: `${BASE}/assets/4k-b-vec.svg`,
    invertUsage: true,
  },
];

const PLAN_FEATURES = [
  [
    'Both 2K & 4K Resolution',
    'Standard AI Models',
    'Standard Backgrounds',
    'Single Image Generation',
    'Product Catalogue Templates',
    'Email Support',
  ],
  [
    'Both 2K & 4K Resolution',
    'Premium AI Models',
    'Premium Backgrounds',
    'Bulk Image Generation',
    'Marketplace Templates',
    'Priority Support',
  ],
  [
    'Both 2K & 4K Resolution',
    'Premium AI Models',
    'Premium Backgrounds',
    'Bulk Image Generation',
    'Marketplace Templates',
    'Dedicated Support',
  ],
] as const;

function detectCountry(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const lang = navigator.language ?? '';
    if (tz.startsWith('Asia/Kolkata') || tz.startsWith('Asia/Calcutta') || lang === 'en-IN')
      return 'IN';
    if (tz.startsWith('Asia/Dubai') || tz.startsWith('Asia/Muscat')) return 'AE';
    if (tz.startsWith('Europe/London') || lang.startsWith('en-GB')) return 'GB';
    if (tz.startsWith('America/') || lang.startsWith('en-US')) return 'US';
  } catch {
    /* SSR or restricted env */
  }
  return 'IN';
}

function formatPrice(paise: number, country: string, rates: Record<string, number>): string {
  const inr = paise / 100;
  const rate = rates[country] ?? 1;
  const converted = inr * rate;
  const { code, locale } = CURRENCY[country] ?? { code: 'INR', locale: 'en-IN' };
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: code,
    maximumFractionDigits: code === 'INR' ? 0 : 2,
    minimumFractionDigits: code === 'INR' ? 0 : 2,
  }).format(converted);
}

function paise(p: number) {
  return `₹${(p / 100).toLocaleString('en-IN')}`;
}

type Rzp = { open: () => void };
declare global {
  interface Window {
    Razorpay?: new (opts: Record<string, unknown>) => Rzp;
  }
}

function loadRazorpay(): Promise<boolean> {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

export default function PricingPage(): React.ReactElement {
  const router = useRouter();
  const qc = useQueryClient();
  const [toast, setToast] = useState('');
  const [buying, setBuying] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'catalogue' | 'tryon'>('catalogue');
  const [salesModal, setSalesModal] = useState<string | null>(null);
  const [country, setCountry] = useState('IN');
  const [showCountry, setShowCountry] = useState(false);
  const [rates, setRates] = useState<Record<string, number>>(FALLBACK_RATES);
  const [ratesLoading, setRatesLoading] = useState(true);
  const countryRef = useRef<HTMLDivElement>(null);

  const { data: credits } = useQuery<{
    balance: number;
    recent: { delta: number; reason: string; createdAt: string }[];
  }>({
    queryKey: ['credits'],
    queryFn: () => api.get('/v1/credits'),
    staleTime: 60_000,
  });

  const { data: me } = useQuery<{ tier: string }>({
    queryKey: ['me'],
    queryFn: () => api.get('/v1/me'),
    staleTime: 60_000,
  });

  const { data: paymentHistory } = useQuery<{
    payments: {
      planId: string;
      planName: string | null;
      credits: number;
      status: string;
      paidAt: string | null;
    }[];
  }>({
    queryKey: ['payment-history'],
    queryFn: () => api.get('/v1/payments/history'),
    staleTime: 5 * 60_000,
  });

  const { data: plans = [], isLoading: plansLoading } = useQuery<CreditPlan[]>({
    queryKey: ['credit-plans'],
    queryFn: () => api.get<CreditPlan[]>('/v1/payments/plans'),
    staleTime: 5 * 60 * 1000,
  });
  const visiblePlans = plans.filter((plan) => plan.slug !== 'free');

  const { data: resolutionData } = useQuery<{ resolutions: ResolutionConfigs }>({
    queryKey: ['resolution-configs'],
    queryFn: () => api.get('/v1/config/resolutions'),
    staleTime: 10 * 60 * 1000,
  });

  const resolutions: ResolutionConfigs = resolutionData?.resolutions ?? {
    HD: { enabled: false, creditCost: 10 },
    '2K': { enabled: true, creditCost: 25 },
    '4K': { enabled: true, creditCost: 40 },
  };

  useEffect(() => {
    setCountry(detectCountry());
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch('https://api.frankfurter.app/latest?from=INR&to=USD,GBP,AED', {
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((data: { rates: Record<string, number> }) => {
        setRates({ IN: 1, ...data.rates });
      })
      .catch(() => {})
      .finally(() => setRatesLoading(false));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (countryRef.current && !countryRef.current.contains(e.target as Node))
        setShowCountry(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const COUNTRIES = [
    { code: 'IN', label: 'India (₹)', name: 'India' },
    { code: 'US', label: 'United States ($)', name: 'USA' },
    { code: 'GB', label: 'United Kingdom (£)', name: 'UK' },
    { code: 'AE', label: 'UAE (د.إ)', name: 'UAE' },
  ];

  const isNonIn = country !== 'IN';

  function displayTotal(basePaise: number): string {
    return formatPrice(basePaise + Math.round(basePaise * GST_RATE), country, rates);
  }
  function displayBase(basePaise: number): string {
    return formatPrice(basePaise, country, rates);
  }
  function displayTax(basePaise: number): string {
    return formatPrice(Math.round(basePaise * GST_RATE), country, rates);
  }

  async function buy(plan: CreditPlan) {
    if (buying) return;
    setBuying(plan.slug);
    try {
      const ok = await loadRazorpay();
      if (!ok || !window.Razorpay) {
        setToast('Could not load payment gateway. Please try again.');
        return;
      }

      const order = await api.post<{
        orderId: string;
        amount: number;
        currency: string;
        keyId: string;
        credits: number;
        label: string;
      }>('/v1/payments/orders', { planId: plan.slug });

      await new Promise<void>((resolve, reject) => {
        const RazorpayClass = window.Razorpay as NonNullable<typeof window.Razorpay>;
        const rzp = new RazorpayClass({
          key: order.keyId,
          amount: order.amount,
          currency: order.currency,
          order_id: order.orderId,
          name: 'Ai Vastra',
          description: `${order.label} — ${plan.credits.toLocaleString('en-IN')} Credits`,
          handler: async (response: {
            razorpay_order_id: string;
            razorpay_payment_id: string;
            razorpay_signature: string;
          }) => {
            try {
              await api.post('/v1/payments/verify', {
                razorpayOrderId: response.razorpay_order_id,
                razorpayPaymentId: response.razorpay_payment_id,
                razorpaySignature: response.razorpay_signature,
              });
              resolve();
            } catch (err) {
              reject(err);
            }
          },
          modal: { ondismiss: () => reject(new Error('dismissed')) },
          theme: { color: C.pink },
        });
        rzp.open();
      });

      qc.invalidateQueries({ queryKey: ['credits'] });
      setToast(`${plan.credits.toLocaleString('en-IN')} credits added to your account!`);
      setTimeout(() => router.push('/catalogues'), 1500);
    } catch (err) {
      if (err instanceof Error && err.message === 'dismissed') {
        // user closed modal — no toast
      } else {
        setToast((err as Error).message ?? 'Payment failed. Please try again.');
      }
    } finally {
      setBuying(null);
    }
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', background: C.bg }}>
      {/* Topbar with country selector */}
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
        <TopBar
          title="Pricing & Plan"
          subtitle="Create professional fashion catalogues without photoshoots, models, or editing headaches."
          right={
            <div ref={countryRef} style={{ position: 'relative', flexShrink: 0 }}>
              <button
                type="button"
                onClick={() => setShowCountry(!showCountry)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  padding: 8,
                  width: 130,
                  height: 40,
                  borderRadius: 8,
                  border: `1px solid ${C.border}`,
                  background: C.white,
                  fontFamily: 'inherit',
                  fontSize: 13,
                  fontWeight: 500,
                  color: C.text,
                  cursor: 'pointer',
                  boxSizing: 'border-box',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ display: 'flex', alignItems: 'center' }}>{FLAGS[country]}</span>
                  <span style={{ fontSize: 12, fontWeight: 500, color: C.mid }}>
                    {COUNTRIES.find((c) => c.code === country)?.name}
                  </span>
                </span>
                <ChevronDown size={14} />
              </button>
              {showCountry && (
                <div
                  style={{
                    position: 'absolute',
                    top: 44,
                    right: 0,
                    width: 200,
                    background: C.white,
                    border: `1px solid ${C.border}`,
                    borderRadius: 8,
                    boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
                    overflow: 'hidden',
                    zIndex: 10,
                  }}
                >
                  {COUNTRIES.map((c) => (
                    <button
                      key={c.code}
                      type="button"
                      onClick={() => {
                        setCountry(c.code);
                        setShowCountry(false);
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '10px 12px',
                        fontSize: 13,
                        fontWeight: 500,
                        color: country === c.code ? C.pink : C.mid,
                        cursor: 'pointer',
                        background: country === c.code ? 'rgba(245,92,122,0.06)' : 'transparent',
                        border: 'none',
                        width: '100%',
                        fontFamily: 'inherit',
                        textAlign: 'left',
                      }}
                    >
                      {FLAGS[c.code]} {c.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          }
        />
      </div>

      {/* Current Plan Banner */}
      {(() => {
        const currentTier = me?.tier ?? 'free';
        const balance = credits?.balance ?? 0;
        const currentPaidPlan = plans.find((plan) => plan.slug === currentTier) ?? null;
        const latestPaidForCurrentTier =
          paymentHistory?.payments?.find((p) => p.status === 'paid' && p.planId === currentTier) ??
          null;
        const freeTrialGrant =
          credits?.recent?.find((e) => e.reason === 'FREE_TRIAL' && e.delta > 0)?.delta ?? null;
        const isFreeTier = currentTier === 'free';
        const planName = isFreeTier
          ? 'Free'
          : (currentPaidPlan?.name ?? latestPaidForCurrentTier?.planName ?? currentTier);
        const planCredits: number | null = isFreeTier
          ? freeTrialGrant
          : (currentPaidPlan?.credits ?? latestPaidForCurrentTier?.credits ?? null);
        const pct = planCredits ? Math.min(100, Math.round((balance / planCredits) * 100)) : 100;
        const activatedDate = latestPaidForCurrentTier?.paidAt
          ? new Date(latestPaidForCurrentTier.paidAt).toLocaleDateString('en-IN', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })
          : null;

        return (
          <div
            style={{
              margin: '24px auto 0',
              maxWidth: 1080,
              borderRadius: 16,
              background: grad,
              display: 'flex',
              alignItems: 'stretch',
              overflow: 'hidden',
              minHeight: 160,
            }}
          >
            {/* Left — plan info */}
            <div
              style={{
                flex: 1,
                padding: '28px 32px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <span
                  style={{
                    display: 'inline-block',
                    padding: '3px 12px',
                    borderRadius: 20,
                    background: 'rgba(255,255,255,0.25)',
                    color: C.white,
                    fontSize: 11,
                    fontWeight: 700,
                    marginBottom: 12,
                    letterSpacing: '0.3px',
                  }}
                >
                  Current Plan
                </span>
                <div
                  style={{
                    fontSize: 26,
                    fontWeight: 800,
                    color: C.white,
                    lineHeight: 1.2,
                    marginBottom: 8,
                  }}
                >
                  {planName}
                </div>
                <div
                  style={{
                    fontSize: 13,
                    color: 'rgba(255,255,255,0.82)',
                    lineHeight: '20px',
                    maxWidth: 480,
                  }}
                >
                  Designed for growing brands creating AI-powered fashion catalogues and virtual
                  try-ons at scale.
                </div>
                {activatedDate && (
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)', marginTop: 6 }}>
                    Plan Activated on {activatedDate}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => setActiveTab('catalogue')}
                style={{
                  marginTop: 20,
                  alignSelf: 'flex-start',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 20px',
                  borderRadius: 10,
                  border: 'none',
                  background: C.white,
                  color: C.text,
                  fontFamily: 'inherit',
                  fontWeight: 700,
                  fontSize: 14,
                  cursor: 'pointer',
                }}
              >
                Upgrade Plan <ChevronRight />
              </button>
            </div>

            {/* Divider */}
            <div style={{ width: 1, background: 'rgba(255,255,255,0.2)', margin: '24px 0' }} />

            {/* Right — credits */}
            <div
              style={{
                width: 300,
                padding: '28px 32px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                gap: 10,
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  color: 'rgba(255,255,255,0.7)',
                  fontWeight: 600,
                  letterSpacing: '0.3px',
                }}
              >
                Credits Remaining
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>
                <span style={{ fontSize: 40, fontWeight: 800, color: C.white, lineHeight: 1 }}>
                  {balance.toLocaleString('en-IN')}
                </span>
                {planCredits !== null && (
                  <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.6)', marginLeft: 2 }}>
                    /{planCredits.toLocaleString('en-IN')}
                  </span>
                )}
              </div>
              {/* Progress bar — only shown when on a paid plan */}
              {planCredits !== null && (
                <div
                  style={{
                    height: 8,
                    borderRadius: 100,
                    background: 'rgba(255,255,255,0.25)',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${pct}%`,
                      borderRadius: 100,
                      background: C.white,
                      transition: 'width 0.4s ease',
                    }}
                  />
                </div>
              )}
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)', lineHeight: '16px' }}>
                Credits are shared across AI Catalogue Generation and AI Virtual Try-On.
              </div>
            </div>
          </div>
        );
      })()}

      {/* Tab toggle */}
      <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 24px 32px' }}>
        <div
          style={{
            display: 'grid',
            // Single column while the Virtual Try-On tab below is commented out.
            gridTemplateColumns: '1fr',
            borderRadius: 14,
            border: `1px solid ${C.border}`,
            background: C.white,
            padding: 4,
            gap: 4,
          }}
        >
          {(
            [
              {
                key: 'catalogue',
                label: 'AI Catalogue Generation',
                icon: (
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path
                      d="M14.6668 7.33337L13.8028 6.46937C13.6541 6.31941 13.4771 6.20037 13.2822 6.11914C13.0872 6.03791 12.878 5.99609 12.6668 5.99609C12.4556 5.99609 12.2465 6.03791 12.0515 6.11914C11.8565 6.20037 11.6796 6.31941 11.5308 6.46937L7.3335 10.6667"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M2.66683 5.33325C2.31321 5.33325 1.97407 5.47373 1.72402 5.72378C1.47397 5.97382 1.3335 6.31296 1.3335 6.66659V13.3333C1.3335 13.6869 1.47397 14.026 1.72402 14.2761C1.97407 14.5261 2.31321 14.6666 2.66683 14.6666H9.3335C9.68712 14.6666 10.0263 14.5261 10.2763 14.2761C10.5264 14.026 10.6668 13.6869 10.6668 13.3333"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M8.66667 5.33333C9.03486 5.33333 9.33333 5.03486 9.33333 4.66667C9.33333 4.29848 9.03486 4 8.66667 4C8.29848 4 8 4.29848 8 4.66667C8 5.03486 8.29848 5.33333 8.66667 5.33333Z"
                      fill="currentColor"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M13.3335 1.33325H6.66683C5.93045 1.33325 5.3335 1.93021 5.3335 2.66659V9.33325C5.3335 10.0696 5.93045 10.6666 6.66683 10.6666H13.3335C14.0699 10.6666 14.6668 10.0696 14.6668 9.33325V2.66659C14.6668 1.93021 14.0699 1.33325 13.3335 1.33325Z"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ),
              },
              /* AI Virtual Try-On Offline tab — hidden for now, keep for later re-enable.
              {
                key: 'tryon',
                label: 'AI Virtual Try-On Offline',
                icon: (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="M9.53589 3.90909C9.53589 2.85473 10.4868 2 11.6599 2C12.8329 2 13.7839 2.85473 13.7839 3.90909C13.7839 4.40532 13.6046 4.85733 13.2925 5.19682C12.6948 5.84706 11.8015 6.50197 11.8015 7.34545V7.6299M11.8015 7.6299C12.533 7.6214 13.2674 7.82458 13.8845 8.24056L21.317 13.2509C22.6234 14.1315 21.9305 16 20.2975 16H18M11.8015 7.6299C11.076 7.63834 10.3534 7.85497 9.751 8.27872L2.65531 13.27C1.38322 14.1648 2.08721 16 3.70254 16H6"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                    <path
                      d="M6 18C6 16.1144 6 15.1716 6.58579 14.5858C7.17157 14 8.11438 14 10 14H14C15.8856 14 16.8284 14 17.4142 14.5858C18 15.1716 18 16.1144 18 18C18 19.8856 18 20.8284 17.4142 21.4142C16.8284 22 15.8856 22 14 22H10C8.11438 22 7.17157 22 6.58579 21.4142C6 20.8284 6 19.8856 6 18Z"
                      stroke="currentColor"
                      strokeWidth="2"
                    />
                  </svg>
                ),
              },
              */
            ] as const
          ).map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  padding: '10px 20px',
                  borderRadius: 10,
                  border: 'none',
                  background: isActive ? C.dark : 'transparent',
                  color: isActive ? C.onDark : C.mid,
                  fontFamily: 'inherit',
                  fontWeight: 600,
                  fontSize: 14,
                  cursor: 'pointer',
                  transition: 'background 0.18s, color 0.18s',
                  whiteSpace: 'nowrap',
                }}
              >
                {tab.icon}
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Pricing cards */}
      <div style={{ background: C.bg }}>
        {/* AI Virtual Try-On Offline pricing cards — hidden for now (gated to false), keep for later re-enable. */}
        {false && activeTab === 'tryon' && (
          <div style={{ padding: '0 10px 48px', maxWidth: 1320, margin: '0 auto' }}>
            {/* Two option cards */}
            <div
              style={{
                display: 'flex',
                gap: 20,
                alignItems: 'stretch',
                justifyContent: 'center',
              }}
            >
              {/* Option 2 — Only Try-On */}
              <div
                style={{
                  width: 410,
                  flex: '0 0 auto',
                  background: C.card,
                  border: `2px solid color-mix(in srgb, ${C.mid} 30%, transparent)`,
                  borderRadius: 20,
                  padding: 24,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 20,
                  boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
                }}
              >
                {/* Badge */}
                <span
                  style={{
                    alignSelf: 'flex-start',
                    padding: '4px 14px',
                    borderRadius: 6,
                    background: C.field,
                    border: `1px solid color-mix(in srgb, ${C.mid} 35%, transparent)`,
                    color: C.text,
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: '0.5px',
                  }}
                >
                  Offline
                </span>

                <div style={{ fontSize: 18, fontWeight: 800, color: C.text, lineHeight: 1.2 }}>
                  Virtual Try-On Platform
                </div>

                {/* Price */}
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                  <span
                    style={{
                      fontSize: 36,
                      fontWeight: 900,
                      color: C.text,
                      letterSpacing: '-1.5px',
                    }}
                  >
                    ₹30,000
                  </span>
                  <span style={{ fontSize: 13, color: C.mid }}>/month + GST</span>
                </div>

                {/* Key stat */}
                <div
                  style={{
                    background: C.field,
                    border: `1px solid ${C.border}`,
                    borderRadius: 12,
                    padding: '12px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    height: 64,
                  }}
                >
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 10,
                      background: C.card,
                      border: `1px solid ${C.border}`,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <Shirt size={16} color={C.text} />
                  </div>
                  <div>
                    <div
                      style={{
                        fontSize: 16,
                        fontWeight: 600,
                        color: C.text,
                        lineHeight: '20px',
                        letterSpacing: 0,
                      }}
                    >
                      Up to 30,000
                    </div>
                    <div
                      style={{
                        fontSize: 10,
                        fontWeight: 500,
                        color: C.mid,
                        lineHeight: '16px',
                        letterSpacing: 0,
                      }}
                    >
                      Virtual Try-On Sessions
                    </div>
                  </div>
                </div>

                {/* Features */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: 361.33 }}>
                  {[
                    'Unlimited AI Models',
                    'Unlimited Backgrounds Library',
                    'White-Label Integration',
                    'Priority Support',
                    'Regular Feature Updates',
                  ].map((f) => (
                    <div
                      key={f}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        width: 361.33,
                        height: 18,
                      }}
                    >
                      <span
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: '50%',
                          background: C.field,
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}
                      >
                        <CheckIcon size={10} color={C.text} />
                      </span>
                      <span style={{ fontSize: 12, color: C.text, fontWeight: 500 }}>{f}</span>
                    </div>
                  ))}
                </div>

                {/* Catalogue note — below features */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.text }}>
                    Need AI Catalogue Images?
                  </div>
                  <div
                    style={{
                      background: C.field,
                      border: `1px solid ${C.border}`,
                      borderRadius: 10,
                      padding: '10px 12px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      height: 64,
                    }}
                  >
                    <span
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 8,
                        background: C.card,
                        border: `1px solid ${C.border}`,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <ImagePlus size={14} color={C.text} />
                    </span>
                    <div>
                      <div
                        style={{
                          fontSize: 16,
                          fontWeight: 600,
                          color: C.text,
                          lineHeight: '20px',
                          letterSpacing: 0,
                        }}
                      >
                        ₹15 per Image
                      </div>
                      <div
                        style={{
                          fontSize: 10,
                          fontWeight: 500,
                          color: C.mid,
                          lineHeight: '16px',
                          letterSpacing: 0,
                        }}
                      >
                        Generate additional AI catalogue images
                      </div>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  className="btn-hover-opacity"
                  onClick={() =>
                    setSalesModal(
                      "Hi, I'm interested in the Virtual Try-On Only plan (Option 2 — ₹30,000/month). Please get in touch with more details.",
                    )
                  }
                  style={{
                    marginTop: 'auto',
                    width: '100%',
                    padding: 11,
                    borderRadius: 10,
                    border: 'none',
                    background: C.text,
                    color: C.card,
                    fontFamily: 'inherit',
                    fontWeight: 700,
                    fontSize: 14,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                  }}
                >
                  Contact Sales <ArrowRight size={14} />
                </button>
              </div>

              {/* Option 1 — Virtual Try-On + Catalogue */}
              <div
                style={{
                  width: 410,
                  flex: '0 0 auto',
                  background: C.card,
                  border: `2px solid color-mix(in srgb, ${C.pink} 40%, transparent)`,
                  borderRadius: 20,
                  padding: 24,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 20,
                  boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
                }}
              >
                {/* Badge */}
                <span
                  style={{
                    alignSelf: 'flex-start',
                    padding: '4px 14px',
                    borderRadius: 6,
                    background: `color-mix(in srgb, ${C.pink} 10%, transparent)`,
                    border: `1px solid color-mix(in srgb, ${C.pink} 40%, transparent)`,
                    color: C.text,
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: '0.5px',
                  }}
                >
                  Offline
                </span>

                <div style={{ fontSize: 18, fontWeight: 800, color: C.text, lineHeight: 1.2 }}>
                  Virtual Try-On + Catalogue Studio
                </div>

                {/* Price */}
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                  <span
                    style={{
                      fontSize: 36,
                      fontWeight: 900,
                      color: C.text,
                      letterSpacing: '-1.5px',
                    }}
                  >
                    ₹49,999
                  </span>
                  <span style={{ fontSize: 13, color: C.mid }}>/month + GST</span>
                </div>

                {/* Key stats */}
                <div
                  style={{
                    display: 'flex',
                    background:
                      'linear-gradient(90deg, rgba(245,92,122,0.05) 0%, rgba(246,181,83,0.05) 100%)',
                    border: `1px solid color-mix(in srgb, ${C.pink} 20%, transparent)`,
                    borderRadius: 12,
                    overflow: 'hidden',
                  }}
                >
                  {[
                    {
                      icon: <Image size={14} color="#fff" />,
                      iconBg: 'linear-gradient(to right, #F55C7A, #F6B553)',
                      count: '2,500',
                      label: 'AI Catalogue Images',
                    },
                    {
                      icon: <Shirt size={14} color="#fff" />,
                      iconBg: 'linear-gradient(to right, #F55C7A, #F6B553)',
                      count: '25,000',
                      label: 'Virtual Try-On Sessions',
                    },
                  ].map((s, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: static list, no reorder
                    <Fragment key={i}>
                      {i > 0 && (
                        <div
                          style={{
                            width: 1,
                            background: `color-mix(in srgb, ${C.pink} 20%, transparent)`,
                            margin: '8px 0',
                          }}
                        />
                      )}
                      <div
                        key={s.label}
                        style={{
                          flex: 1,
                          padding: '8px 6px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          height: 64,
                        }}
                      >
                        <div
                          style={{
                            width: 40,
                            height: 40,
                            borderRadius: 6,
                            background: s.iconBg,
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                          }}
                        >
                          {s.icon}
                        </div>
                        <div>
                          <div
                            style={{
                              fontSize: 16,
                              fontWeight: 600,
                              color: C.text,
                              lineHeight: '20px',
                              letterSpacing: 0,
                            }}
                          >
                            {s.count}
                          </div>
                          <div
                            style={{
                              fontSize: 10,
                              fontWeight: 500,
                              color: C.mid,
                              lineHeight: '16px',
                              letterSpacing: 0,
                            }}
                          >
                            {s.label}
                          </div>
                        </div>
                      </div>
                    </Fragment>
                  ))}
                </div>

                {/* Features */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: 361.33 }}>
                  {[
                    'AI Catalogue Generation & Virtual Try-On',
                    'Unlimited AI Models',
                    'Unlimited Backgrounds Library',
                    'White-Label Branding',
                    'Priority Technical Support',
                  ].map((f) => (
                    <div
                      key={f}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        width: 361.33,
                        height: 18,
                      }}
                    >
                      <span
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: '50%',
                          background: `color-mix(in srgb, ${C.amber} 18%, transparent)`,
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}
                      >
                        <CheckIcon size={10} color={C.pink} />
                      </span>
                      <span style={{ fontSize: 12, color: C.text, fontWeight: 500 }}>{f}</span>
                    </div>
                  ))}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {/* Add-on label */}
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.text }}>
                    Pay ₹5,000 Extra and Get
                  </div>

                  {/* Add-on box */}
                  <div
                    style={{
                      background: C.field,
                      border: `1px solid ${C.border}`,
                      borderRadius: 10,
                      padding: '12px 14px',
                    }}
                  >
                    <div style={{ display: 'flex', gap: 10 }}>
                      {(
                        [
                          {
                            icon: <ImagePlus size={14} color={C.text} />,
                            val: '+500',
                            label: 'AI Catalogue Creation',
                          },
                          {
                            icon: <Shirt size={14} color={C.text} />,
                            val: '+5,000',
                            label: 'Virtual Try-On Sessions',
                          },
                        ] as const
                      ).map((a) => (
                        <div
                          key={a.label}
                          style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}
                        >
                          <span
                            style={{
                              width: 40,
                              height: 40,
                              borderRadius: 8,
                              border: `1px solid ${C.border}`,
                              background: C.card,
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0,
                            }}
                          >
                            {a.icon}
                          </span>
                          <div>
                            <div
                              style={{
                                fontSize: 16,
                                fontWeight: 600,
                                color: C.text,
                                lineHeight: '20px',
                                letterSpacing: 0,
                              }}
                            >
                              {a.val}
                            </div>
                            <div
                              style={{
                                fontSize: 10,
                                fontWeight: 500,
                                color: C.mid,
                                lineHeight: '16px',
                                letterSpacing: 0,
                              }}
                            >
                              {a.label}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  className="hover-brightness"
                  onClick={() =>
                    setSalesModal(
                      "Hi, I'm interested in the Virtual Try-On + Catalogue Creation plan (Option 1 — ₹49,999/month). Please get in touch with more details.",
                    )
                  }
                  style={{
                    marginTop: 'auto',
                    width: '100%',
                    padding: 11,
                    borderRadius: 10,
                    border: 'none',
                    background: 'linear-gradient(to right, #F55C7A, #F6B553)',
                    color: '#fff',
                    fontFamily: 'inherit',
                    fontWeight: 700,
                    fontSize: 14,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                  }}
                >
                  Contact Sales <ArrowRight size={14} />
                </button>
              </div>
            </div>
          </div>
        )}
        {activeTab === 'catalogue' && (
          <div
            style={{
              display: 'flex',
              gap: 20,
              justifyContent: 'center',
              alignItems: 'stretch',
              flexWrap: 'wrap',
              maxWidth: 1080,
              margin: '0 auto',
              padding: '0 24px',
            }}
          >
            {plansLoading
              ? [0, 1, 2].map((i) => (
                  <div
                    key={i}
                    style={{
                      width: 320,
                      minHeight: 560,
                      background: C.card,
                      border: `1px solid ${C.border}`,
                      borderRadius: 16,
                    }}
                  />
                ))
              : visiblePlans.map((plan, idx) => {
                  // biome-ignore lint/style/noNonNullAssertion: PLAN_META has entries for every plan index
                  const meta = PLAN_META[idx] ?? PLAN_META[0]!;
                  const features = PLAN_FEATURES[idx] ?? PLAN_FEATURES[0];
                  const accent = meta.accent;
                  const highlighted = plan.isHighlighted;

                  const cardContent = (
                    // biome-ignore lint/correctness/useJsxKeyInIterable: cardContent is wrapped by keyed parent in the map return below
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        background: C.card,
                        borderRadius: highlighted ? 14 : 16,
                        flex: 1,
                        position: 'relative',
                      }}
                    >
                      {/* Card header */}
                      <div style={{ padding: '24px 24px 0' }}>
                        {/* Most Popular badge — absolutely positioned so it doesn't shift card height */}
                        {highlighted && plan.badge && (
                          <span
                            style={{
                              position: 'absolute',
                              top: -14,
                              left: '50%',
                              transform: 'translateX(-50%)',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              padding: '5px 14px',
                              borderRadius: 20,
                              background: grad,
                              color: C.white,
                              fontSize: 11,
                              fontWeight: 700,
                              whiteSpace: 'nowrap',
                              boxShadow: '0 2px 10px rgba(245,92,122,0.35)',
                            }}
                          >
                            ⭐ {plan.badge}
                          </span>
                        )}

                        {/* Plan name row */}
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 12,
                            marginBottom: 22,
                          }}
                        >
                          <span
                            style={{
                              width: 44,
                              height: 44,
                              borderRadius: 12,
                              background: `color-mix(in srgb, ${meta.iconBg} 14%, transparent)`,
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: 22,
                              flexShrink: 0,
                            }}
                          >
                            {meta.iconSrc ? (
                              // biome-ignore lint/performance/noImgElement: local SVG asset
                              <img
                                src={meta.iconSrc}
                                alt=""
                                width={22}
                                height={22}
                                style={
                                  meta.invertUsage ? { filter: 'var(--icon-invert)' } : undefined
                                }
                              />
                            ) : (
                              <meta.Icon size={22} color={meta.iconColor ?? accent} />
                            )}
                          </span>
                          <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <span style={{ fontSize: 22, fontWeight: 700, color: C.text }}>
                              {plan.name}
                            </span>
                            <span style={{ fontSize: 11, fontWeight: 600, color: C.mid }}>
                              {meta.subtext}
                            </span>
                          </span>
                        </div>

                        {/* Price */}
                        <div style={{ marginBottom: 20 }}>
                          <span
                            style={{
                              fontSize: 40,
                              fontWeight: 800,
                              color: C.text,
                              letterSpacing: '-1.5px',
                              opacity: ratesLoading && isNonIn ? 0.5 : 1,
                              transition: 'opacity 0.2s',
                            }}
                          >
                            {displayBase(plan.basePaise)}
                          </span>
                          <span style={{ fontSize: 14, color: C.mid, marginLeft: 4 }}>+ Taxes</span>
                        </div>

                        {/* Usage overview — 2K / 4K image counts */}
                        {(() => {
                          const cost2k = resolutions['2K']?.creditCost ?? 25;
                          const cost4k = resolutions['4K']?.creditCost ?? 40;
                          const count2k = Math.floor(plan.credits / cost2k);
                          const count4k = Math.floor(plan.credits / cost4k);
                          return (
                            <div
                              style={{
                                display: 'flex',
                                background: C.field,
                                border: `1px solid ${C.border}`,
                                borderRadius: 10,
                                overflow: 'hidden',
                                marginBottom: 20,
                              }}
                            >
                              <div
                                style={{
                                  flex: 1,
                                  display: 'flex',
                                  flexDirection: 'column',
                                  alignItems: 'center',
                                  gap: 6,
                                  padding: '14px 12px',
                                }}
                              >
                                {/* biome-ignore lint/performance/noImgElement: local SVG asset */}
                                <img
                                  src={meta.icon2k}
                                  alt="2K"
                                  width={24}
                                  height={24}
                                  style={
                                    meta.invertUsage ? { filter: 'var(--icon-invert)' } : undefined
                                  }
                                />
                                <span style={{ fontSize: 15, fontWeight: 700, color: C.text }}>
                                  {count2k.toLocaleString('en-IN')} Images
                                </span>
                              </div>
                              <div style={{ width: 1, background: C.border, margin: '12px 0' }} />
                              <div
                                style={{
                                  flex: 1,
                                  display: 'flex',
                                  flexDirection: 'column',
                                  alignItems: 'center',
                                  gap: 6,
                                  padding: '14px 12px',
                                }}
                              >
                                {/* biome-ignore lint/performance/noImgElement: local SVG asset */}
                                <img
                                  src={meta.icon4k}
                                  alt="4K"
                                  width={24}
                                  height={24}
                                  style={
                                    meta.invertUsage ? { filter: 'var(--icon-invert)' } : undefined
                                  }
                                />
                                <span style={{ fontSize: 15, fontWeight: 700, color: C.text }}>
                                  {count4k.toLocaleString('en-IN')} Images
                                </span>
                              </div>
                            </div>
                          );
                        })()}
                      </div>

                      {/* Divider */}
                      <div style={{ height: 1, background: C.border, margin: '0 24px' }} />

                      {/* Feature list */}
                      <div style={{ padding: '16px 24px', flex: 1 }}>
                        {/* Dynamic credits line — same style as feature rows */}
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            marginBottom: 12,
                          }}
                        >
                          <span
                            style={{
                              width: 20,
                              height: 20,
                              borderRadius: '50%',
                              background: meta.checkGrad
                                ? 'linear-gradient(to right, #F55C7A, #F6B553)'
                                : `color-mix(in srgb, ${accent} 16%, transparent)`,
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0,
                            }}
                          >
                            <CheckIcon size={11} color={meta.checkGrad ? '#fff' : accent} />
                          </span>
                          <span style={{ fontSize: 13, color: C.text, fontWeight: 500 }}>
                            {plan.credits.toLocaleString('en-IN')} Credits included
                          </span>
                        </div>

                        {features.map((feat) => (
                          <div
                            key={feat}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 10,
                              marginBottom: 12,
                            }}
                          >
                            <span
                              style={{
                                width: 20,
                                height: 20,
                                borderRadius: '50%',
                                background: meta.checkGrad
                                  ? 'linear-gradient(to right, #F55C7A, #F6B553)'
                                  : `color-mix(in srgb, ${accent} 16%, transparent)`,
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0,
                              }}
                            >
                              <CheckIcon size={11} color={meta.checkGrad ? '#fff' : accent} />
                            </span>
                            <span style={{ fontSize: 13, color: C.text, fontWeight: 500 }}>
                              {feat}
                            </span>
                          </div>
                        ))}
                      </div>

                      {/* CTA button */}
                      <div style={{ padding: '4px 24px 24px' }}>
                        <Tooltip
                          tip={
                            buying && buying !== plan.slug
                              ? 'Another payment is in progress'
                              : undefined
                          }
                          position="bottom"
                        >
                          <button
                            type="button"
                            className={
                              highlighted ? 'upgrade-plan-btn highlighted' : 'upgrade-plan-btn'
                            }
                            onClick={() => void buy(plan)}
                            disabled={!!buying}
                            style={{
                              width: '100%',
                              padding: '13px 20px',
                              borderRadius: 10,
                              border: 'none',
                              background: highlighted ? grad : '#141414',
                              color: '#fff',
                              fontFamily: 'inherit',
                              fontWeight: 700,
                              fontSize: 15,
                              cursor: buying ? 'not-allowed' : 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: 8,
                              opacity: buying && buying !== plan.slug ? 0.45 : 1,
                            }}
                          >
                            {buying === plan.slug ? 'Processing…' : 'Upgrade'}
                            {buying !== plan.slug && <ArrowRight size={18} />}
                          </button>
                        </Tooltip>
                      </div>
                    </div>
                  );

                  return highlighted ? (
                    <div
                      key={plan.slug}
                      style={{
                        width: 320,
                        paddingTop: 16,
                        display: 'flex',
                        flexDirection: 'column',
                      }}
                    >
                      <div
                        style={{
                          padding: 2,
                          borderRadius: 18,
                          background: grad,
                          display: 'flex',
                          flexDirection: 'column',
                          flex: 1,
                          boxShadow: '0 6px 28px rgba(245,92,122,0.22)',
                        }}
                      >
                        {cardContent}
                      </div>
                    </div>
                  ) : (
                    <div
                      key={plan.slug}
                      style={{
                        width: 320,
                        paddingTop: 16,
                        display: 'flex',
                        flexDirection: 'column',
                      }}
                    >
                      <div
                        style={{
                          flex: 1,
                          display: 'flex',
                          flexDirection: 'column',
                          borderRadius: 16,
                          border: `1px solid ${C.border}`,
                          boxShadow: '0 2px 10px rgba(0,0,0,0.05)',
                        }}
                      >
                        {cardContent}
                      </div>
                    </div>
                  );
                })}
          </div>
        )}

        {/* Footer info bar — catalogue tab only */}
        {activeTab === 'catalogue' && (
          <div
            style={{
              maxWidth: 1080,
              margin: '32px auto 0',
              borderTop: `1px solid ${C.border}`,
              padding: '16px 24px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              flexWrap: 'wrap',
              fontSize: 12,
              color: C.mid,
            }}
          >
            <Info size={14} color={C.mid} />
            <span>
              All plans include both <span style={{ color: C.pink, fontWeight: 600 }}>2K</span> &{' '}
              <span style={{ color: C.amber, fontWeight: 600 }}>4K</span> downloads.
            </span>
          </div>
        )}

        {isNonIn && (
          <div
            style={{
              textAlign: 'center',
              fontSize: 11,
              color: C.light,
              padding: '12px 24px 0',
            }}
          >
            💳 Payment processed via Razorpay (India). International cards may not be supported.
          </div>
        )}

        <div style={{ height: 48 }} />
      </div>

      {salesModal !== null && (
        <SupportModal initialMessage={salesModal} onClose={() => setSalesModal(null)} />
      )}

      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            background: C.dark,
            color: C.onDark,
            padding: '10px 20px',
            borderRadius: 8,
            fontSize: 13,
            zIndex: 1000,
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}
