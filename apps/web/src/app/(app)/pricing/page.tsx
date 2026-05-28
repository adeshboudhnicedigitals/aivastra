'use client';
import { Fragment, useState } from 'react';
import { useRouter } from 'next/navigation';
import { C, grad } from '@/components/tokens';
import { CheckIcon, XIcon } from '@/components/icons';

const RAZORPAY_KEY = process.env.NEXT_PUBLIC_RAZORPAY_KEY ?? '';

interface Plan { name: string; sub: string; credits: string; price: string; amount: number; highlight: boolean; badge?: string }

const PLANS: Plan[] = [
  { name: 'Starter Pack', sub: 'Individual sellers & small stores', credits: '2,500', price: '₹2,500', amount: 250000, highlight: false },
  { name: 'Growth Pack', sub: 'Brands & growing businesses', credits: '5,000', price: '₹5,000', amount: 500000, highlight: true, badge: 'Best Value' },
  { name: 'Pro Pack', sub: 'Large teams & agencies', credits: '10,000', price: '₹10,000', amount: 1000000, highlight: false },
];

const SECTIONS = [
  { title: '1. ESSENTIAL FEATURES', rows: [
    { feature: 'Brand-safe Outputs', vals: ['Yes', 'Yes', 'Yes'] },
    { feature: 'No Watermark', vals: ['Yes', 'Yes', 'Yes'] },
    { feature: 'AI-powered Photoshoot', vals: ['Yes', 'Yes', 'Yes'] },
    { feature: 'Model Library Access', vals: ['Yes', 'Yes', 'Yes'] },
    { feature: 'Background Library', vals: ['Yes', 'Yes', 'Yes'] },
    { feature: 'Template Library', vals: ['Yes', 'Yes', 'Yes'] },
    { feature: 'Premium Models Access', vals: ['No', 'Limited', 'Full'] },
    { feature: 'Premium Backgrounds', vals: ['No', 'Limited', 'Full'] },
  ] },
  { title: '2. IMAGE OUTPUT & USAGE', rows: [
    { feature: 'HD (25 credits)', vals: ['100 Images', '200 Images', '400 Images'] },
    { feature: '2K (35 credits)', vals: ['71 Images', '142 Images', '285 Images'] },
    { feature: '4K (40 credits)', vals: ['62 Images', '125 Images', '250 Images'] },
  ] },
  { title: '3. SCALING FEATURES', rows: [
    { feature: 'Bulk Upload', vals: ['No', 'Yes', 'Yes'] },
    { feature: 'Rendering Priority', vals: ['Standard', 'Faster', 'Fastest'] },
  ] },
  { title: '4. SYSTEM LIMITS', rows: [
    { feature: 'Max Upload File Size', vals: ['10 MB', '20 MB', '50 MB'] },
    { feature: 'Turnaround Time', vals: ['Immediate', 'Immediate', 'Immediate + Priority'] },
  ] },
  { title: '5. CUSTOMER SUPPORT', rows: [
    { feature: 'Support', vals: ['Email', 'Email & Chat', 'Email, Chat & Priority'] },
    { feature: 'Dedicated Account Manager', vals: ['No', 'No', 'Yes'] },
  ] },
];

type Rzp = { open: () => void };
declare global { interface Window { Razorpay?: new (opts: Record<string, unknown>) => Rzp } }

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

  async function buy(plan: Plan) {
    // TODO(wire): real order creation must come from backend; this is a test-mode stub.
    if (!RAZORPAY_KEY) { setToast('Payments not configured (set NEXT_PUBLIC_RAZORPAY_KEY).'); setTimeout(() => setToast(''), 2500); return; }
    const ok = await loadRazorpay();
    if (!ok || !window.Razorpay) { setToast('Could not load payment gateway.'); setTimeout(() => setToast(''), 2500); return; }
    const rzp = new window.Razorpay({
      key: RAZORPAY_KEY,
      amount: plan.amount,
      currency: 'INR',
      name: 'Ai Vastra',
      description: `${plan.name} — ${plan.credits} Credits`,
      handler: () => { setToast('Payment successful!'); setTimeout(() => router.push('/settings'), 1200); },
      theme: { color: C.pink },
    });
    rzp.open();
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto' }}>
      <div style={{ padding: '40px 80px 28px', textAlign: 'center' }}>
        <h1 style={{ fontWeight: 700, fontSize: 28, color: C.text, marginBottom: 10, lineHeight: 1.3 }}>Simple pricing for catalogue-ready visuals</h1>
        <p style={{ fontSize: 16, color: C.mid }}>Create professional fashion catalogues without photoshoots, models, or editing headaches.</p>
      </div>

      <div style={{ margin: '0 28px 40px', background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
        {/* Plan headers */}
        <div style={{ display: 'flex', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ width: 260, flexShrink: 0, padding: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 18 }}>✦</span>
            <span style={{ fontWeight: 700, fontSize: 16, color: C.text }}>Features</span>
          </div>
          {PLANS.map((plan, pi) => (
            <div key={pi} style={{ flex: 1, padding: 16, background: plan.highlight ? grad : pi === 0 ? 'rgba(254,239,242,0.4)' : 'rgba(254,239,242,0.2)', borderLeft: `1px solid ${C.border}`, position: 'relative' }}>
              {plan.badge && <div style={{ position: 'absolute', top: 10, right: 10, padding: '3px 10px', borderRadius: 4, background: 'rgba(255,255,255,0.22)', fontSize: 11, fontWeight: 700, color: C.onDark }}>⭐ {plan.badge}</div>}
              <div style={{ fontWeight: 700, fontSize: 15, color: plan.highlight ? C.onDark : C.text, marginBottom: 4 }}>{plan.name}</div>
              <div style={{ fontSize: 13, color: plan.highlight ? C.onDark : C.mid, marginBottom: 10 }}>{plan.sub}</div>
              <div style={{ fontWeight: 700, fontSize: 22, color: plan.highlight ? C.onDark : C.text, marginBottom: 14 }}>{plan.credits} Credits</div>
              <button onClick={() => void buy(plan)} style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, fontSize: 13, background: plan.highlight ? C.onDark : grad, color: plan.highlight ? C.dark : C.onDark }}>Buy @ {plan.price}</button>
            </div>
          ))}
        </div>

        {SECTIONS.map((sec, si) => (
          <Fragment key={si}>
            <div style={{ display: 'flex', background: C.field, borderBottom: `1px solid ${C.border}` }}>
              <div style={{ width: 260, flexShrink: 0, padding: '10px 20px', fontSize: 11, fontWeight: 700, color: C.mid, letterSpacing: '.5px' }}>{sec.title}</div>
              {PLANS.map((_, pi) => <div key={pi} style={{ flex: 1, borderLeft: `1px solid ${C.border}`, background: pi === 1 ? 'rgba(245,92,122,0.03)' : 'transparent' }} />)}
            </div>
            {sec.rows.map((row, ri) => (
              <div key={ri} style={{ display: 'flex', borderBottom: `1px solid ${C.border}` }}>
                <div style={{ width: 260, flexShrink: 0, padding: '14px 20px', fontSize: 13, color: C.text, fontWeight: 500 }}>{row.feature}</div>
                {row.vals.map((v, vi) => (
                  <div key={vi} style={{ flex: 1, padding: '14px 12px', textAlign: 'center', fontSize: 13, color: v === 'No' ? '#9CA3AF' : v === 'Yes' ? C.mint : v === 'Full' ? C.pink : v === 'Limited' ? C.amber : C.mid, fontWeight: ['Yes', 'No', 'Full', 'Limited'].includes(v) ? 500 : 400, borderLeft: `1px solid ${C.border}`, background: vi === 1 ? 'rgba(245,92,122,0.03)' : 'transparent' }}>
                    {v === 'Yes' ? <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: '50%', background: 'rgba(32,158,70,0.12)' }}><CheckIcon color={C.mint} size={13} /></span>
                      : v === 'No' ? <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: '50%', background: 'rgba(245,92,122,0.12)' }}><XIcon size={13} /></span>
                      : v}
                  </div>
                ))}
              </div>
            ))}
          </Fragment>
        ))}
      </div>

      {toast && <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: C.dark, color: C.onDark, padding: '10px 20px', borderRadius: 8, fontSize: 13, zIndex: 1000 }}>{toast}</div>}
    </div>
  );
}
