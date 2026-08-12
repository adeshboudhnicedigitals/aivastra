import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BarChart2, Building2, Rocket } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { FlagAE, FlagGB, FlagIN, FlagUS } from '@/components/icons';
import { C } from '@/components/tokens';
import { api } from '@/lib/api';

export interface CreditPlan {
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

export const FLAGS: Record<string, React.ReactElement> = {
  IN: React.createElement(FlagIN, { size: 16 }),
  US: React.createElement(FlagUS, { size: 16 }),
  GB: React.createElement(FlagGB, { size: 16 }),
  AE: React.createElement(FlagAE, { size: 16 }),
};

const GST_RATE = 0.18;

export type PaymentResult =
  | {
      kind: 'success';
      planName: string;
      base: string; // formatted, e.g. "₹1,000"
      tax: string;
      total: string;
      baseCredits: number;
      bonusPercent: number | null; // null => no bonus line, single "Credits added" line
      bonusCredits: number;
      totalCredits: number;
    }
  | {
      kind: 'error';
      message: string;
      onRetry: () => void;
    };

interface ResolutionConfig {
  enabled: boolean;
  creditCost: number;
}
export interface ResolutionConfigs {
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
export const PLAN_META = [
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
] as const;

export const PLAN_FEATURES = [
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

export const COUNTRIES = [
  { code: 'IN', label: 'India (₹)', name: 'India' },
  { code: 'US', label: 'United States ($)', name: 'USA' },
  { code: 'GB', label: 'United Kingdom (£)', name: 'UK' },
  { code: 'AE', label: 'UAE (د.إ)', name: 'UAE' },
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

export function usePricingData() {
  const qc = useQueryClient();
  const [paymentResult, setPaymentResult] = useState<PaymentResult | null>(null);
  const [buying, setBuying] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'catalogue' | 'tryon'>('catalogue');
  const [salesModal, setSalesModal] = useState<string | null>(null);
  const [country, setCountry] = useState('IN');
  const [showCountry, setShowCountry] = useState(false);
  const [couponModalPlan, setCouponModalPlan] = useState<CreditPlan | null>(null);
  const [couponCode, setCouponCode] = useState('');
  const [couponApplying, setCouponApplying] = useState(false);
  const [couponError, setCouponError] = useState('');
  const [couponApplied, setCouponApplied] = useState(false);
  const [couponBonusPercent, setCouponBonusPercent] = useState<number | null>(null);
  const [gstinModalPlan, setGstinModalPlan] = useState<CreditPlan | null>(null);
  const [checkoutGstin, setCheckoutGstin] = useState('');
  const [rates, setRates] = useState<Record<string, number>>(FALLBACK_RATES);
  const [ratesLoading, setRatesLoading] = useState(true);
  const countryRef = useRef<HTMLDivElement>(null);

  const { data: credits } = useQuery<{
    balance: number;
    firstPurchaseBonusPercent: number | null;
    recent: { delta: number; reason: string; createdAt: string }[];
  }>({
    queryKey: ['credits'],
    queryFn: () => api.get('/v1/credits'),
    staleTime: 60_000,
  });
  const firstPurchaseBonusPercent = credits?.firstPurchaseBonusPercent ?? null;

  const { data: me } = useQuery<{ tier: string; gstin: string | null }>({
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
  const hasPriorPurchase = paymentHistory?.payments?.some((p) => p.status === 'paid') ?? false;

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

  async function buy(plan: CreditPlan, gstin?: string) {
    if (buying) return;
    setBuying(plan.slug);
    try {
      const ok = await loadRazorpay();
      if (!ok || !window.Razorpay) {
        setPaymentResult({
          kind: 'error',
          message: 'Could not load payment gateway. Please try again.',
          onRetry: () => void buy(plan, gstin),
        });
        return;
      }

      const order = await api.post<{
        orderId: string;
        amount: number;
        currency: string;
        keyId: string;
        credits: number;
        label: string;
      }>('/v1/payments/orders', { planId: plan.slug, gstin: gstin || undefined });

      let creditsGranted = plan.credits;
      await new Promise<void>((resolve, reject) => {
        const RazorpayClass = window.Razorpay as NonNullable<typeof window.Razorpay>;
        const rzp = new RazorpayClass({
          key: order.keyId,
          amount: order.amount,
          currency: order.currency,
          order_id: order.orderId,
          name: 'Ai Vastra',
          description: firstPurchaseBonusPercent
            ? `${order.label} — ${plan.credits.toLocaleString('en-IN')} Credits + ${firstPurchaseBonusPercent}% bonus`
            : `${order.label} — ${plan.credits.toLocaleString('en-IN')} Credits`,
          handler: async (response: {
            razorpay_order_id: string;
            razorpay_payment_id: string;
            razorpay_signature: string;
          }) => {
            try {
              const verified = await api.post<{ creditsGranted?: number }>('/v1/payments/verify', {
                razorpayOrderId: response.razorpay_order_id,
                razorpayPaymentId: response.razorpay_payment_id,
                razorpaySignature: response.razorpay_signature,
              });
              creditsGranted = verified.creditsGranted ?? plan.credits;
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
      const bonusPercent = firstPurchaseBonusPercent;
      const bonusCredits = bonusPercent ? creditsGranted - plan.credits : 0;
      setPaymentResult({
        kind: 'success',
        planName: plan.name,
        base: displayBase(plan.basePaise),
        tax: displayTax(plan.basePaise),
        total: displayTotal(plan.basePaise),
        baseCredits: plan.credits,
        bonusPercent,
        bonusCredits,
        totalCredits: creditsGranted,
      });
    } catch (err) {
      if (err instanceof Error && err.message === 'dismissed') {
        // user closed modal — no toast
      } else {
        setPaymentResult({
          kind: 'error',
          message: (err as Error).message ?? 'Payment failed. Please try again.',
          onRetry: () => void buy(plan, gstin),
        });
      }
    } finally {
      setBuying(null);
    }
  }

  // Gate before the actual purchase flow: first-time buyers who weren't
  // auto-attributed to a campaign at signup get a chance to manually enter a
  // coupon code before proceeding to Razorpay. Already-attributed users and
  // repeat buyers (no bonus possible either way) skip straight to checkout.
  function startBuy(plan: CreditPlan) {
    if (buying) return;
    if (firstPurchaseBonusPercent === null && !hasPriorPurchase) {
      setCouponCode('');
      setCouponError('');
      setCouponApplied(false);
      setCouponBonusPercent(null);
      setCouponModalPlan(plan);
      return;
    }
    openGstinModal(plan);
  }

  function openGstinModal(plan: CreditPlan) {
    setCheckoutGstin(me?.gstin ?? '');
    setGstinModalPlan(plan);
  }

  function closeGstinModal() {
    if (buying) return;
    setGstinModalPlan(null);
  }

  function confirmGstinAndPay() {
    const plan = gstinModalPlan;
    setGstinModalPlan(null);
    if (plan) void buy(plan, checkoutGstin);
  }

  function closeCouponModal() {
    if (couponApplying) return;
    setCouponModalPlan(null);
  }

  async function applyCoupon() {
    if (!couponCode.trim() || couponApplying) return;
    setCouponApplying(true);
    setCouponError('');
    try {
      const res = await api.post<{ applied: boolean; bonusPercent: number | null }>(
        '/v1/credits/apply-coupon',
        { code: couponCode.trim() },
      );
      setCouponApplied(true);
      setCouponBonusPercent(res.bonusPercent);
      await qc.invalidateQueries({ queryKey: ['credits'] });
    } catch (err) {
      setCouponError((err as Error).message ?? 'Invalid or expired coupon code.');
    } finally {
      setCouponApplying(false);
    }
  }

  function continueFromCouponModal() {
    const plan = couponModalPlan;
    setCouponModalPlan(null);
    if (plan) openGstinModal(plan);
  }

  // Current Plan Banner derived values — computed once here instead of
  // once per layout component.
  const currentTier = me?.tier ?? 'free';
  const balance = credits?.balance ?? 0;
  const currentPaidPlan = plans.find((plan) => plan.slug === currentTier) ?? null;
  const latestPaidForCurrentTier =
    paymentHistory?.payments?.find((p) => p.status === 'paid' && p.planId === currentTier) ?? null;
  const freeTrialGrant =
    credits?.recent?.find((e) => e.reason === 'FREE_TRIAL' && e.delta > 0)?.delta ?? null;
  const isFreeTier = currentTier === 'free';
  const planName = isFreeTier
    ? 'Free'
    : (currentPaidPlan?.name ?? latestPaidForCurrentTier?.planName ?? currentTier);
  const planCredits: number | null = isFreeTier
    ? freeTrialGrant
    : (currentPaidPlan?.credits ?? latestPaidForCurrentTier?.credits ?? null);
  const pct =
    planCredits === null
      ? 100
      : planCredits === 0
        ? 0
        : Math.min(100, Math.round((balance / planCredits) * 100));
  const activatedDate = latestPaidForCurrentTier?.paidAt
    ? new Date(latestPaidForCurrentTier.paidAt).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : null;

  return {
    paymentResult,
    setPaymentResult,
    buying,
    activeTab,
    setActiveTab,
    salesModal,
    setSalesModal,
    country,
    setCountry,
    showCountry,
    setShowCountry,
    countryRef,
    ratesLoading,
    isNonIn,
    visiblePlans,
    plansLoading,
    firstPurchaseBonusPercent,
    resolutions,
    displayBase,
    displayTotal,
    displayTax,
    buy,
    startBuy,
    couponModalPlan,
    couponCode,
    setCouponCode,
    couponApplying,
    couponError,
    couponApplied,
    couponBonusPercent,
    applyCoupon,
    closeCouponModal,
    continueFromCouponModal,
    gstinModalPlan,
    checkoutGstin,
    setCheckoutGstin,
    closeGstinModal,
    confirmGstinAndPay,
    banner: { planName, balance, planCredits, pct, activatedDate },
  };
}
