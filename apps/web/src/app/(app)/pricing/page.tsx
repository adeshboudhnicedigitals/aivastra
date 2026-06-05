'use client';
import { useQuery } from '@tanstack/react-query';
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
  const [toast, setToast] = useState('');
  const [buying, setBuying] = useState<string | null>(null);
  const [country, setCountry] = useState('IN');
  const [showCountry, setShowCountry] = useState(false);
  const countryRef = useRef<HTMLDivElement>(null);

  const { data: plans = [], isLoading: plansLoading } = useQuery<CreditPlan[]>({
    queryKey: ['credit-plans'],
    queryFn: () => api.get<CreditPlan[]>('/v1/payments/plans'),
    staleTime: 5 * 60 * 1000,
  });

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
      <div
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          marginTop: 40,
          marginBottom: 40,
          paddingRight: 28,
        }}
      >
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, height: 72 }}>
          <div
            style={{
              width: '100%',
              height: 40,
              fontWeight: 600,
              fontSize: 28,
              lineHeight: '40px',
              color: C.text,
              textAlign: 'center',
            }}
          >
            Simple pricing for catalogue-ready visuals
          </div>
          <div
            style={{
              width: '100%',
              height: 20,
              fontWeight: 500,
              fontSize: 16,
              lineHeight: '20px',
              color: C.mid,
              textAlign: 'center',
            }}
          >
            Create professional fashion catalogues without photoshoots, models, or editing
            headaches.
          </div>
        </div>
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
              border: '1px solid #EEEEEE',
              background: '#FEFEFE',
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
              <span style={{ fontSize: 12, fontWeight: 500, lineHeight: '16px', color: '#626262' }}>
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
                background: '#FEFEFE',
                border: '1px solid #EEEEEE',
                borderRadius: 8,
                boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
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
      </div>

      <div
        style={{
          width: 1140,
          margin: '0 auto 40px',
          background: C.white,
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          padding: 16,
          boxSizing: 'border-box',
        }}
      >
        {/* Plan headers */}
        <div style={{ display: 'flex', gap: 20, marginBottom: 20 }}>
          <div
            style={{
              width: 262,
              height: 178,
              background: '#F9F9F9',
              border: '1px solid #EEEEEE',
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
              <span style={{ fontSize: 16, fontWeight: 600, lineHeight: '20px', color: '#1F2937' }}>
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
                    height: 178,
                    background: '#F3F4F6',
                    border: '1px solid #EEEEEE',
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
                    height: 178,
                    background: plan.isHighlighted
                      ? 'linear-gradient(90deg, #D94D69 0%, #D49332 100%)'
                      : '#FEEFF266',
                    border: '1px solid #EEEEEE',
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
                      }}
                    >
                      {paise(plan.basePaise + Math.round(plan.basePaise * GST_RATE))}
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        color: plan.isHighlighted ? 'rgba(255,255,255,0.65)' : C.light,
                      }}
                    >
                      ({paise(plan.basePaise)} + {paise(Math.round(plan.basePaise * GST_RATE))} GST)
                    </span>
                  </div>
                  <Tooltip
                    tip={
                      buying && buying !== plan.slug ? 'Another payment is in progress' : undefined
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
                        border: '1px solid #EEEEEE',
                        cursor: buying ? 'not-allowed' : 'pointer',
                        fontFamily: 'inherit',
                        fontWeight: 700,
                        fontSize: 14,
                        lineHeight: '20px',
                        background: '#FEFEFE',
                        color: '#626262',
                        boxSizing: 'border-box',
                        opacity: buying && buying !== plan.slug ? 0.5 : 1,
                      }}
                    >
                      {buying === plan.slug
                        ? 'Processing…'
                        : `Buy — ${paise(plan.basePaise + Math.round(plan.basePaise * GST_RATE))}`}
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
                        v === 'No'
                          ? '#9CA3AF'
                          : v === 'Yes'
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
                        <XIcon size={13} />
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
