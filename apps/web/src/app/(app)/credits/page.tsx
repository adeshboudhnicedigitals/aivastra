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

const STATUS_COLOR: Record<string, string> = {
  pending: 'var(--amber)',
  approved: 'var(--mint)',
  rejected: 'var(--peach)',
};

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
    <div className="av-main-inner" style={{ maxWidth: 720 }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontWeight: 700, fontSize: 26, letterSpacing: '-0.01em', margin: '0 0 6px' }}>Credits</h1>
        <p style={{ margin: 0, fontSize: 14, color: 'var(--mute)' }}>Request credits from the admin to run virtual try-ons.</p>
      </div>

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
        <h2 style={{ fontWeight: 700, fontSize: 18, letterSpacing: '-0.01em', margin: '0 0 16px' }}>Packages</h2>
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
            <input
              type="number" min={1} max={1000} placeholder="e.g. 50"
              value={amount} onChange={(e) => setAmount(e.target.value)}
              style={{ height: 46, padding: '0 16px', background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 12, fontSize: 14, color: 'var(--ink)', fontFamily: 'inherit', outline: 'none' }}
            />
          </div>
          <div className="av-field">
            <label className="av-field-label">Note <span className="av-field-hint">(optional)</span></label>
            <input
              type="text" placeholder="Tell us what you're working on…"
              value={note} onChange={(e) => setNote(e.target.value)}
              style={{ height: 46, padding: '0 16px', background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 12, fontSize: 14, color: 'var(--ink)', fontFamily: 'inherit', outline: 'none' }}
            />
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
  );
}
