'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Fragment, useEffect, useRef, useState } from 'react';
import {
  CheckIcon,
  ChevronDown,
  FlagAE,
  FlagGB,
  FlagIN,
  FlagUS,
  SparklesIcon,
  XIcon,
} from '@/components/icons';
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

// Currency metadata per country
const CURRENCY: Record<string, { code: string; locale: string }> = {
  IN: { code: 'INR', locale: 'en-IN' },
  US: { code: 'USD', locale: 'en-US' },
  GB: { code: 'GBP', locale: 'en-GB' },
  AE: { code: 'AED', locale: 'en-AE' },
};

// Fallback rates (INR → target) used when live fetch fails
const FALLBACK_RATES: Record<string, number> = {
  IN: 1,
  US: 0.012,
  GB: 0.0095,
  AE: 0.044,
};

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

// INR display used in the buy button disclaimer
function paise(p: number) {
  return `₹${(p / 100).toLocaleString('en-IN')}`;
}

const SECTIONS = [
  {
    title: '1. ESSENTIAL FEATURES',
    rows: [
      { feature: 'Brand-safe Outputs', vals: ['Yes', 'Yes', 'Yes'] },
      { feature: 'No Watermark', vals: ['Yes', 'Yes', 'Yes'] },
      { feature: 'AI-powered Photoshoot', vals: ['Yes', 'Yes', 'Yes'] },
      { feature: 'Model Library Access', vals: ['Yes', 'Yes', 'Yes'] },
      { feature: 'Background Library', vals: ['Yes', 'Yes', 'Yes'] },
      { feature: 'Template Library', vals: ['Yes', 'Yes', 'Yes'] },
      { feature: 'Premium Models Access', vals: ['No', 'Limited', 'Full'] },
      { feature: 'Premium Backgrounds', vals: ['No', 'Limited', 'Full'] },
    ],
  },
  {
    title: '2. IMAGE OUTPUT & USAGE',
    rows: [
      { feature: 'HD (25 credits)', vals: ['100 Images', '200 Images', '400 Images'] },
      { feature: '2K (35 credits)', vals: ['71 Images', '142 Images', '285 Images'] },
      { feature: '4K (40 credits)', vals: ['62 Images', '125 Images', '250 Images'] },
    ],
  },
  {
    title: '3. SCALING FEATURES',
    rows: [
      { feature: 'Bulk Upload', vals: ['No', 'Yes', 'Yes'] },
      { feature: 'Rendering Priority', vals: ['Standard', 'Faster', 'Fastest'] },
    ],
  },
  {
    title: '4. SYSTEM LIMITS',
    rows: [
      { feature: 'Max Upload File Size', vals: ['10 MB', '20 MB', '50 MB'] },
      { feature: 'Turnaround Time', vals: ['Immediate', 'Immediate', 'Immediate + Priority'] },
    ],
  },
  {
    title: '5. CUSTOMER SUPPORT',
    rows: [{ feature: 'Support', vals: ['Email', 'Email & Chat', 'Email, Chat & Priority'] }],
  },
];

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
  const [country, setCountry] = useState('IN');
  const [showCountry, setShowCountry] = useState(false);
  const [rates, setRates] = useState<Record<string, number>>(FALLBACK_RATES);
  const [ratesLoading, setRatesLoading] = useState(true);
  const countryRef = useRef<HTMLDivElement>(null);

  const { data: plans = [], isLoading: plansLoading } = useQuery<CreditPlan[]>({
    queryKey: ['credit-plans'],
    queryFn: () => api.get<CreditPlan[]>('/v1/payments/plans'),
    staleTime: 5 * 60 * 1000,
  });

  // Auto-detect country from browser locale + timezone on mount
  useEffect(() => {
    setCountry(detectCountry());
  }, []);

  // Fetch live exchange rates from frankfurter.app (free, no API key)
  useEffect(() => {
    const controller = new AbortController();
    fetch('https://api.frankfurter.app/latest?from=INR&to=USD,GBP,AED', {
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((data: { rates: Record<string, number> }) => {
        setRates({ IN: 1, ...data.rates });
      })
      .catch(() => {
        /* silently fall back to FALLBACK_RATES */
      })
      .finally(() => setRatesLoading(false));
    return () => controller.abort();
  }, []);

  // Close country dropdown on outside click
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

      // Balance changed server-side — refresh it so the sidebar reflects it.
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
    <div style={{ flex: 1, overflowY: 'auto' }}>
      <TopBar
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
                height: 32,
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
                <span style={{ fontSize: 12, fontWeight: 500, lineHeight: '16px', color: C.mid }}>
                  {COUNTRIES.find((c) => c.code === country)?.name}
                </span>
              </span>
              <ChevronDown size={14} />
            </button>
            {showCountry && (
              <div
                style={{
                  position: 'absolute',
                  top: 36,
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

      <div style={{ textAlign: 'center', marginTop: 40, marginBottom: 32 }}>
        <div style={{ fontSize: 28, fontWeight: 600, color: C.text, lineHeight: '40px' }}>
          Simple pricing for catalogue-ready visuals
        </div>
        <div
          style={{ fontSize: 16, fontWeight: 500, color: C.mid, lineHeight: '20px', marginTop: 8 }}
        >
          Create professional fashion catalogues without photoshoots, models, or editing headaches.
        </div>
      </div>

      <div
        style={{
          width: '100%',
          maxWidth: 1140,
          margin: '40px auto 40px',
          background: C.white,
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          padding: 16,
          boxSizing: 'border-box',
          overflowX: 'auto',
        }}
      >
        <div style={{ minWidth: 1108 }}>
          {/* Plan headers */}
          <div style={{ display: 'flex', gap: 20, marginBottom: 20 }}>
            <div
              style={{
                width: 262,
                minHeight: 178,
                background: C.field,
                border: `1px solid ${C.border}`,
                borderRadius: 8,
                padding: 12,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                alignItems: 'center',
                boxSizing: 'border-box',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <SparklesIcon size={18} />
                <span style={{ fontSize: 16, fontWeight: 600, lineHeight: '20px', color: C.text }}>
                  Features
                </span>
              </div>
            </div>
            {plansLoading
              ? [0, 1, 2].map((i) => (
                  <div
                    key={i}
                    style={{
                      width: 262,
                      minHeight: 178,
                      background: C.field,
                      border: `1px solid ${C.border}`,
                      borderRadius: 8,
                      boxSizing: 'border-box',
                    }}
                  />
                ))
              : plans.map((plan) => (
                  <div
                    key={plan.slug}
                    style={{
                      width: 262,
                      minHeight: 178,
                      background: plan.isHighlighted
                        ? 'linear-gradient(90deg, #D94D69 0%, #D49332 100%)'
                        : C.card,
                      border: plan.isHighlighted ? 'none' : `1px solid ${C.border}`,
                      borderRadius: 8,
                      padding: 12,
                      display: 'flex',
                      flexDirection: 'column',
                      boxSizing: 'border-box',
                      position: 'relative',
                    }}
                  >
                    {plan.badge && (
                      <div
                        style={{
                          position: 'absolute',
                          top: 8,
                          right: 8,
                          padding: '3px 10px',
                          borderRadius: 4,
                          background: plan.isHighlighted ? 'rgba(255,255,255,0.22)' : grad,
                          fontSize: 11,
                          fontWeight: 700,
                          color: C.onDark,
                        }}
                      >
                        ⭐ {plan.badge}
                      </div>
                    )}
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: 15,
                        color: plan.isHighlighted ? '#FFFFFF' : C.text,
                        marginBottom: 4,
                      }}
                    >
                      {plan.name}
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        color: plan.isHighlighted ? 'rgba(255,255,255,0.8)' : C.mid,
                        marginBottom: 10,
                      }}
                    >
                      {plan.subtext}
                    </div>
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: 22,
                        color: plan.isHighlighted ? '#FFFFFF' : C.text,
                        marginBottom: 2,
                      }}
                    >
                      {plan.credits.toLocaleString('en-IN')} Credits
                    </div>
                    <div
                      style={{
                        marginBottom: 8,
                        display: 'flex',
                        alignItems: 'baseline',
                        gap: 6,
                        flexWrap: 'wrap',
                      }}
                    >
                      <span
                        style={{
                          fontSize: 15,
                          fontWeight: 700,
                          color: plan.isHighlighted ? '#FFFFFF' : C.text,
                          opacity: ratesLoading && isNonIn ? 0.4 : 1,
                          transition: 'opacity 0.2s',
                        }}
                      >
                        {displayTotal(plan.basePaise)}
                      </span>
                      <span
                        style={{
                          fontSize: 11,
                          color: plan.isHighlighted ? 'rgba(255,255,255,0.75)' : C.mid,
                          opacity: ratesLoading && isNonIn ? 0.4 : 1,
                          transition: 'opacity 0.2s',
                        }}
                      >
                        {`(${displayBase(plan.basePaise)} + ${displayTax(plan.basePaise)} ${isNonIn ? 'Indian GST' : 'GST'})`}
                      </span>
                    </div>
                    {isNonIn && (
                      <div
                        style={{
                          fontSize: 10,
                          color: plan.isHighlighted ? 'rgba(255,255,255,0.6)' : C.light,
                          marginBottom: 6,
                        }}
                      >
                        Billed as {paise(plan.basePaise + Math.round(plan.basePaise * GST_RATE))}{' '}
                        INR
                      </div>
                    )}
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
                        onClick={() => void buy(plan)}
                        disabled={!!buying}
                        style={{
                          width: '100%',
                          padding: '8px 20px',
                          height: 36,
                          borderRadius: 8,
                          border: plan.isHighlighted
                            ? '1px solid rgba(255,255,255,0.3)'
                            : `1px solid ${C.border}`,
                          cursor: buying ? 'not-allowed' : 'pointer',
                          fontFamily: 'inherit',
                          fontWeight: 700,
                          fontSize: 14,
                          lineHeight: '20px',
                          background: plan.isHighlighted ? 'rgba(255,255,255,0.15)' : C.white,
                          color: plan.isHighlighted ? '#ffffff' : C.mid,
                          boxSizing: 'border-box',
                          opacity: buying && buying !== plan.slug ? 0.5 : 1,
                        }}
                      >
                        {buying === plan.slug
                          ? 'Processing…'
                          : `Buy — ${displayTotal(plan.basePaise)}`}
                      </button>
                    </Tooltip>
                  </div>
                ))}
          </div>

          {SECTIONS.map((sec) => (
            <Fragment key={sec.title}>
              <div
                style={{
                  display: 'flex',
                  gap: 20,
                  background: C.field,
                  borderBottom: `1px solid ${C.border}`,
                  padding: '10px 16px',
                }}
              >
                <div
                  style={{
                    width: 262,
                    fontSize: 11,
                    fontWeight: 700,
                    color: C.mid,
                    letterSpacing: '.5px',
                  }}
                >
                  {sec.title}
                </div>
                {plans.map((plan) => (
                  <div key={plan.slug} style={{ width: 262 }} />
                ))}
              </div>
              {sec.rows.map((row) => (
                <div
                  key={row.feature}
                  style={{
                    display: 'flex',
                    gap: 20,
                    borderBottom: `1px solid ${C.border}`,
                    padding: '14px 16px',
                  }}
                >
                  <div style={{ width: 262, fontSize: 13, color: C.text, fontWeight: 500 }}>
                    {row.feature}
                  </div>
                  {row.vals.map((v, vi) => (
                    <div
                      key={plans[vi]?.slug ?? vi}
                      style={{
                        width: 262,
                        textAlign: 'center',
                        fontSize: 13,
                        color:
                          v === 'Yes'
                            ? C.mint
                            : v === 'Full'
                              ? C.pink
                              : v === 'Limited'
                                ? C.amber
                                : C.mid,
                        fontWeight: ['Yes', 'No', 'Full', 'Limited'].includes(v) ? 500 : 400,
                      }}
                    >
                      {v === 'Yes' ? (
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: 22,
                            height: 22,
                            borderRadius: '50%',
                            background: 'rgba(32,158,70,0.12)',
                          }}
                        >
                          <CheckIcon color={C.mint} size={13} />
                        </span>
                      ) : v === 'No' ? (
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: 22,
                            height: 22,
                            borderRadius: '50%',
                            background: 'rgba(245,92,122,0.12)',
                          }}
                        >
                          <XIcon size={13} color={C.mid} />
                        </span>
                      ) : (
                        v
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </Fragment>
          ))}
        </div>
      </div>

      {isNonIn && (
        <div
          style={{
            textAlign: 'center',
            fontSize: 12,
            color: C.light,
            marginBottom: 32,
          }}
        >
          💳 Payment processed via Razorpay (India). International cards may not be supported.
        </div>
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
