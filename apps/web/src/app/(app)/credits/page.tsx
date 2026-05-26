'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface CreditsResponse { balance: number; recent: { id: string; delta: number; reason: string; createdAt: string }[] }
interface CreditRequest { id: string; creditsRequested: number; note: string | null; status: string; createdAt: string; creditsApproved: number | null }

const SpinnerIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="av-spin">
    <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
  </svg>
);
const CheckIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12l5 5L20 7"/>
  </svg>
);
const XIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6L6 18M6 6l12 12"/>
  </svg>
);

const STATUS_COLOR: Record<string, string> = {
  pending: 'var(--amber)',
  approved: 'var(--mint)',
  rejected: 'var(--peach)',
};

const PLANS = [
  { name: 'Starter Pack', sub: 'Individual sellers & small stores', credits: '2,500', price: '₹2,500', highlight: false },
  { name: 'Growth Pack', sub: 'Brands & growing businesses', credits: '5,000', price: '₹5,000', highlight: true, badge: 'Best Value' },
  { name: 'Pro Pack', sub: 'Large teams & agencies', credits: '10,000', price: '₹10,000', highlight: false },
];

const PRICING_SECTIONS = [
  {
    title: '1. ESSENTIAL FEATURES',
    rows: [
      { feature: 'Brand-safe Outputs', vals: ['Yes', 'Yes', 'Yes'] },
      { feature: 'No Watermark', vals: ['Yes', 'Yes', 'Yes'] },
      { feature: 'AI-powered Photoshoot', vals: ['Yes', 'Yes', 'Yes'] },
      { feature: 'Model Library Access', vals: ['Yes', 'Yes', 'Yes'] },
      { feature: 'Background Library', vals: ['Yes', 'Yes', 'Yes'] },
      { feature: 'Premium Models Access', vals: ['No', 'Limited', 'Full'] },
      { feature: 'Premium Backgrounds', vals: ['No', 'Limited', 'Full'] },
    ],
  },
  {
    title: '2. IMAGE OUTPUT & USAGE',
    rows: [
      { feature: 'HD (25 credits)', vals: ['100 Images', '200 Images', '400 Images'] },
      { feature: '2K (35 credits)', vals: ['71 Images', '142 Images', '285 Images'] },
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
    title: '4. CUSTOMER SUPPORT',
    rows: [
      { feature: 'Support', vals: ['Email', 'Email & Chat', 'Email, Chat & Priority'] },
      { feature: 'Dedicated Account Manager', vals: ['No', 'No', 'Yes'] },
    ],
  },
];

function renderVal(v: string) {
  if (v === 'Yes') return (
    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: '50%', background: '#e8f5e9' }}>
      <span style={{ color: '#209E46' }}><CheckIcon /></span>
    </span>
  );
  if (v === 'No') return (
    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: '50%', background: '#fce4ec' }}>
      <span style={{ color: 'var(--peach)' }}><XIcon /></span>
    </span>
  );
  const color = v === 'Full' ? 'var(--peach)' : v === 'Limited' ? 'var(--amber)' : 'var(--mute)';
  return <span style={{ color, fontWeight: 500 }}>{v}</span>;
}

function PricingTable() {
  return (
    <div className="av-pricing-table" style={{ marginBottom: 36 }}>
      {/* Plan headers */}
      <div className="av-pricing-table-head">
        <div className="av-pricing-feat-col">
          <span style={{ fontSize: 18 }}>✦</span> Features
        </div>
        {PLANS.map((plan, pi) => (
          <div
            key={pi}
            className={`av-pricing-plan-col${plan.highlight ? ' highlight' : ''}`}
            style={!plan.highlight ? { background: pi === 0 ? 'rgba(254,239,242,0.4)' : 'rgba(254,239,242,0.2)' } : {}}
          >
            {plan.badge && (
              <div style={{
                position: 'absolute', top: 10, right: 10,
                padding: '3px 10px', borderRadius: 4,
                background: plan.highlight ? 'rgba(255,255,255,0.22)' : 'rgba(245,92,122,0.1)',
                fontSize: 11, fontWeight: 700,
                color: plan.highlight ? '#FEFEFE' : 'var(--peach)',
              }}>
                ⭐ {plan.badge}
              </div>
            )}
            <div style={{ fontWeight: 700, fontSize: 15, color: plan.highlight ? '#FEFEFE' : 'var(--ink)', marginBottom: 4 }}>{plan.name}</div>
            <div style={{ fontSize: 13, color: plan.highlight ? '#f9f9f9' : 'var(--mute)', marginBottom: 10 }}>{plan.sub}</div>
            <div style={{ fontWeight: 700, fontSize: 22, color: plan.highlight ? '#FEFEFE' : 'var(--ink)', marginBottom: 14 }}>{plan.credits} Credits</div>
            <button style={{
              width: '100%', padding: '9px 12px', borderRadius: 8, border: 'none', cursor: 'pointer',
              fontFamily: 'inherit', fontWeight: 600, fontSize: 13,
              background: plan.highlight ? '#FEFEFE' : 'var(--grad)',
              color: plan.highlight ? 'var(--ink)' : '#FEFEFE',
            }}>Buy @ {plan.price}</button>
          </div>
        ))}
      </div>

      {/* Feature rows */}
      {PRICING_SECTIONS.map((sec, si) => (
        <div key={si}>
          <div className="av-pricing-section-head">
            <div className="av-pricing-section-label">{sec.title}</div>
            {PLANS.map((_, pi) => (
              <div key={pi} style={{ flex: 1, borderLeft: '1px solid var(--line)', background: pi === 1 ? 'rgba(245,92,122,0.03)' : 'transparent' }} />
            ))}
          </div>
          {sec.rows.map((row, ri) => (
            <div key={ri} className="av-pricing-row">
              <div className="av-pricing-row-feat">{row.feature}</div>
              {row.vals.map((v, vi) => (
                <div key={vi} className="av-pricing-row-val" style={{ background: vi === 1 ? 'rgba(245,92,122,0.03)' : 'transparent' }}>
                  {renderVal(v)}
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

const PACKAGES = [
  { credits: 10, label: '10 credits', desc: '10 try-ons' },
  { credits: 50, label: '50 credits', desc: '50 try-ons · best value' },
  { credits: 100, label: '100 credits', desc: '100 try-ons' },
];

export default function CreditsPage(): React.ReactElement {
  const qc = useQueryClient();
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  const { data: credits } = useQuery<CreditsResponse>({
    queryKey: ['credits'],
    queryFn: () => api.get('/v1/credits'),
  });

  const { data: requests } = useQuery<{ items: CreditRequest[] }>({
    queryKey: ['credit-requests'],
    queryFn: () => api.get('/v1/credits/requests'),
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amt = parseInt(amount, 10);
    if (!amt || amt < 1) { setError('Enter a valid amount'); return; }
    setSubmitting(true); setError(''); setSuccess(false);
    try {
      await api.post('/v1/credits/request', { creditsRequested: amt, note: note || undefined });
      setSuccess(true); setAmount(''); setNote('');
      void qc.invalidateQueries({ queryKey: ['credit-requests'] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      {/* TopBar */}
      <div className="av-topbar">
        <div>
          <div className="av-topbar-title">Pricing</div>
          <div className="av-topbar-sub">Simple pricing for catalogue-ready visuals.</div>
        </div>
      </div>

      <div className="av-main-inner" style={{ overflowY: 'auto' }}>
        {/* Pricing table */}
        <PricingTable />

        {/* Balance card */}
        <div className="av-card" style={{ marginBottom: 24 }}>
          <p style={{ fontSize: 13, color: 'var(--mute)', margin: '0 0 8px' }}>Current balance</p>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontWeight: 700, fontSize: 56, letterSpacing: '-0.03em', background: 'var(--grad)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              {credits?.balance ?? '—'}
            </span>
            <span style={{ fontSize: 18, color: 'var(--mute)', fontWeight: 500 }}>credits</span>
          </div>
          <p style={{ fontSize: 12, color: 'var(--mute)', margin: '8px 0 0' }}>1 credit = 1 virtual try-on generation</p>
        </div>

        {/* Packages */}
        <div style={{ marginBottom: 24 }}>
          <h2 style={{ fontWeight: 700, fontSize: 18, letterSpacing: '-0.01em', margin: '0 0 16px' }}>Quick Request</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14 }}>
            {PACKAGES.map((p) => (
              <button key={p.credits} type="button"
                onClick={() => setAmount(String(p.credits))}
                className="av-card"
                style={{ textAlign: 'left', cursor: 'pointer', border: amount === String(p.credits) ? '1.5px solid var(--peach)' : undefined, boxShadow: amount === String(p.credits) ? '0 0 0 3px rgba(245,92,122,0.12)' : undefined, transition: 'all .15s', fontFamily: 'inherit' }}
              >
                <span style={{ fontWeight: 700, fontSize: 32, letterSpacing: '-0.03em', background: 'var(--grad)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', display: 'block' }}>{p.credits}</span>
                <span style={{ fontWeight: 600, fontSize: 14, display: 'block', marginTop: 4 }}>{p.label}</span>
                <span style={{ fontSize: 12, color: 'var(--mute)', display: 'block', marginTop: 2 }}>{p.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Request form */}
        <div className="av-card" style={{ marginBottom: 24 }}>
          <h2 style={{ fontWeight: 700, fontSize: 18, letterSpacing: '-0.01em', margin: '0 0 8px' }}>Request Credits</h2>
          <p style={{ fontSize: 14, color: 'var(--mute)', margin: '0 0 20px' }}>Submit a request to the admin. They will review and add credits to your account.</p>

          {success && (
            <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 10, border: '1px solid var(--mint)', background: 'var(--mint-soft)', fontSize: 14, color: 'var(--mint)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <CheckIcon /> Request submitted — admin will review shortly.
            </div>
          )}

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div className="av-field">
              <label className="av-field-label">Credits requested</label>
              <input type="number" min={1} max={1000} placeholder="e.g. 50" value={amount} onChange={(e) => setAmount(e.target.value)}
                style={{ height: 46, padding: '0 16px', background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 12, fontSize: 14, color: 'var(--ink)', fontFamily: 'inherit', outline: 'none' }} />
            </div>
            <div className="av-field">
              <label className="av-field-label">Note <span className="av-field-hint">(optional)</span></label>
              <input type="text" placeholder="Tell us what you&#39;re working on…" value={note} onChange={(e) => setNote(e.target.value)}
                style={{ height: 46, padding: '0 16px', background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 12, fontSize: 14, color: 'var(--ink)', fontFamily: 'inherit', outline: 'none' }} />
            </div>
            {error && (
              <div style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid var(--peach)', background: 'rgba(245,92,122,0.06)', fontSize: 14, color: 'var(--peach)' }}>{error}</div>
            )}
            <button type="submit" disabled={submitting || !amount} className="av-btn av-btn-primary" style={{ alignSelf: 'flex-start' }}>
              {submitting ? <><SpinnerIcon /> Submitting…</> : 'Submit request →'}
            </button>
          </form>
        </div>

        {/* Past requests */}
        {requests && requests.items.length > 0 && (
          <div>
            <h2 style={{ fontWeight: 700, fontSize: 18, letterSpacing: '-0.01em', margin: '0 0 16px' }}>Your Requests</h2>
            <div className="av-card" style={{ padding: 0 }}>
              {requests.items.map((r, i) => (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 24px', borderBottom: i < requests.items.length - 1 ? '1px solid var(--line)' : 'none' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLOR[r.status] ?? 'var(--mute)', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontWeight: 600, fontSize: 14, margin: 0, color: 'var(--ink)' }}>{r.creditsRequested} credits requested</p>
                    {r.note && <p style={{ fontSize: 12, color: 'var(--mute)', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.note}</p>}
                    <p style={{ fontSize: 12, color: 'var(--mute)', margin: '2px 0 0' }}>{new Date(r.createdAt).toLocaleDateString()}</p>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                    <span style={{ padding: '3px 10px', borderRadius: 99, fontSize: 11, fontWeight: 600, background: r.status === 'approved' ? 'var(--mint-soft)' : r.status === 'rejected' ? 'rgba(245,92,122,0.10)' : 'rgba(246,181,83,0.10)', color: STATUS_COLOR[r.status] ?? 'var(--mute)' }}>
                      {r.status}
                    </span>
                    {r.creditsApproved != null && r.status === 'approved' && (
                      <span style={{ fontSize: 12, color: 'var(--mint)' }}>+{r.creditsApproved} added</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
