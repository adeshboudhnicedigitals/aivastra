'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

type Tab = 'profile' | 'billing' | 'invoices' | 'activity';

interface MeResponse { id: string; email: string; displayName: string | null; tier: string }
interface CreditsResponse { balance: number; recent: { id: string; delta: number; reason: string; createdAt: string }[] }
interface CreditRequest { id: string; creditsRequested: number; creditsApproved: number | null; note: string | null; status: string; createdAt: string }

const TABS: { k: Tab; label: string }[] = [
  { k: 'profile', label: 'Profile' },
  { k: 'billing', label: 'Billing' },
  { k: 'invoices', label: 'Invoices' },
  { k: 'activity', label: 'Credit Activity' },
];

const PACKAGES = [
  { credits: 10, desc: '10 try-ons' },
  { credits: 50, desc: '50 try-ons · best value' },
  { credits: 100, desc: '100 try-ons' },
];

const STATUS_COLOR: Record<string, string> = {
  pending: 'var(--amber)',
  approved: 'var(--mint)',
  rejected: 'var(--peach)',
};

const SpinnerIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="av-spin">
    <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
  </svg>
);


export default function AccountPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('profile');

  // Profile state
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [nameSaving, setNameSaving] = useState(false);
  const [nameMsg, setNameMsg] = useState('');

  // Billing state
  const [reqAmount, setReqAmount] = useState('');
  const [reqNote, setReqNote] = useState('');
  const [reqSubmitting, setReqSubmitting] = useState(false);
  const [reqSuccess, setReqSuccess] = useState(false);
  const [reqError, setReqError] = useState('');

  const { data: me } = useQuery<MeResponse>({
    queryKey: ['me'],
    queryFn: () => api.get('/v1/me'),
  });

  const { data: credits } = useQuery<CreditsResponse>({
    queryKey: ['credits'],
    queryFn: () => api.get('/v1/credits'),
  });

  const { data: requests } = useQuery<{ items: CreditRequest[] }>({
    queryKey: ['credit-requests'],
    queryFn: () => api.get('/v1/credits/requests'),
  });

  const email = me?.email ?? '';
  const resolvedName = me?.displayName ?? email.split('@')[0] ?? 'User';
  const initials = resolvedName.slice(0, 2).toUpperCase() || 'U';
  // Sync display name field from server on first load
  const fieldValue = displayName ?? me?.displayName ?? '';

  async function saveProfile() {
    setNameSaving(true); setNameMsg('');
    try {
      await api.patch('/v1/me', { displayName: fieldValue.trim() || undefined });
      void qc.invalidateQueries({ queryKey: ['me'] });
      setNameMsg('Saved');
      setTimeout(() => setNameMsg(''), 2500);
    } catch {
      setNameMsg('Failed to save');
    } finally {
      setNameSaving(false);
    }
  }

  async function handleReqSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amt = parseInt(reqAmount, 10);
    if (!amt || amt < 1) { setReqError('Enter a valid amount'); return; }
    setReqSubmitting(true); setReqError(''); setReqSuccess(false);
    try {
      await api.post('/v1/credits/request', { creditsRequested: amt, note: reqNote || undefined });
      setReqSuccess(true); setReqAmount(''); setReqNote('');
      void qc.invalidateQueries({ queryKey: ['credit-requests'] });
    } catch (e) { setReqError((e as Error).message); }
    finally { setReqSubmitting(false); }
  }


  const balance = credits?.balance ?? 0;
  const maxBalance = 2500;
  const fillPct = Math.min(100, Math.round((balance / maxBalance) * 100));

  return (
    <div className="av-main-inner" style={{ maxWidth: 760 }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontWeight: 700, fontSize: 26, letterSpacing: '-0.01em', margin: '0 0 6px' }}>Account</h1>
        <p style={{ margin: 0, fontSize: 14, color: 'var(--mute)' }}>Manage your profile, billing and activity.</p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 28, borderBottom: '1px solid var(--line)', paddingBottom: 0 }}>
        {TABS.map((t) => (
          <button key={t.k} onClick={() => setTab(t.k)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              padding: '8px 16px', fontSize: 14, fontWeight: 600,
              color: tab === t.k ? 'var(--ink)' : 'var(--mute)',
              borderBottom: tab === t.k ? '2px solid var(--ink)' : '2px solid transparent',
              marginBottom: -1, transition: 'color .15s',
            }}
          >{t.label}</button>
        ))}
      </div>

      {/* ── Profile ── */}
      {tab === 'profile' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="av-card" style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <div style={{
              width: 64, height: 64, borderRadius: 18,
              background: 'linear-gradient(135deg, #F55C7A 0%, #F6B553 100%)',
              display: 'grid', placeItems: 'center',
              color: 'white', fontWeight: 800, fontSize: 22, letterSpacing: '-0.04em', flexShrink: 0,
            }}>{initials}</div>
            <div>
              <p style={{ fontWeight: 700, fontSize: 18, margin: '0 0 4px', color: 'var(--ink)' }}>{resolvedName}</p>
              <p style={{ fontSize: 13, color: 'var(--mute)', margin: 0 }}>{email}</p>
              {me?.tier && (
                <span style={{ marginTop: 6, display: 'inline-block', padding: '2px 10px', borderRadius: 99, fontSize: 11, fontWeight: 700, background: 'rgba(246,181,83,0.12)', color: 'var(--amber)', border: '1px solid rgba(246,181,83,0.3)' }}>
                  {me.tier}
                </span>
              )}
            </div>
          </div>

          <div className="av-card" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <h2 style={{ fontWeight: 700, fontSize: 16, margin: 0 }}>Profile Info</h2>
            <div className="av-field">
              <label className="av-field-label">Display name</label>
              <input
                value={fieldValue}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your name"
                style={{ height: 46, padding: '0 16px', background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 12, fontSize: 14, color: 'var(--ink)', fontFamily: 'inherit', outline: 'none' }}
              />
            </div>
            <div className="av-field">
              <label className="av-field-label">Email <span className="av-field-hint">read-only</span></label>
              <input
                value={email}
                disabled
                style={{ height: 46, padding: '0 16px', background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 12, fontSize: 14, color: 'var(--mute)', fontFamily: 'inherit', outline: 'none', cursor: 'not-allowed' }}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button onClick={saveProfile} disabled={nameSaving} className="av-btn av-btn-primary" style={{ alignSelf: 'flex-start' }}>
                {nameSaving ? <><SpinnerIcon /> Saving…</> : 'Save changes'}
              </button>
              {nameMsg && (
                <span style={{ fontSize: 13, color: nameMsg === 'Saved' ? 'var(--mint)' : 'var(--peach)', fontWeight: 600 }}>{nameMsg}</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Billing ── */}
      {tab === 'billing' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="av-card">
            <p style={{ fontSize: 13, color: 'var(--mute)', margin: '0 0 8px' }}>Current balance</p>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 12 }}>
              <span style={{ fontWeight: 700, fontSize: 52, letterSpacing: '-0.03em', background: 'var(--grad)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>{balance}</span>
              <span style={{ fontSize: 16, color: 'var(--mute)', fontWeight: 500 }}>credits</span>
            </div>
            <div style={{ height: 6, borderRadius: 99, background: 'var(--surface-2)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${fillPct}%`, background: 'var(--grad)', borderRadius: 99, transition: 'width .4s ease' }} />
            </div>
            <p style={{ fontSize: 12, color: 'var(--mute)', margin: '8px 0 0' }}>1 credit = 1 virtual try-on</p>
          </div>

          <div className="av-card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <h2 style={{ fontWeight: 700, fontSize: 16, margin: 0 }}>Request Credits</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
              {PACKAGES.map((p) => (
                <button key={p.credits} type="button" onClick={() => setReqAmount(String(p.credits))}
                  className="av-card"
                  style={{
                    textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', padding: 16,
                    border: reqAmount === String(p.credits) ? '1.5px solid var(--peach)' : '1px solid var(--line)',
                    boxShadow: reqAmount === String(p.credits) ? '0 0 0 3px rgba(245,92,122,0.12)' : 'none',
                    transition: 'all .15s',
                  }}>
                  <span style={{ fontWeight: 700, fontSize: 28, letterSpacing: '-0.03em', background: 'var(--grad)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', display: 'block' }}>{p.credits}</span>
                  <span style={{ fontSize: 12, color: 'var(--mute)', display: 'block', marginTop: 2 }}>{p.desc}</span>
                </button>
              ))}
            </div>
            {reqSuccess && (
              <div style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid var(--mint)', background: 'var(--mint-soft)', fontSize: 14, color: 'var(--mint)' }}>
                Request submitted — admin will review shortly.
              </div>
            )}
            <form onSubmit={handleReqSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="av-field">
                <label className="av-field-label">Credits requested</label>
                <input type="number" min={1} max={1000} placeholder="e.g. 50" value={reqAmount}
                  onChange={(e) => setReqAmount(e.target.value)}
                  style={{ height: 46, padding: '0 16px', background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 12, fontSize: 14, color: 'var(--ink)', fontFamily: 'inherit', outline: 'none' }} />
              </div>
              <div className="av-field">
                <label className="av-field-label">Note <span className="av-field-hint">optional</span></label>
                <input type="text" placeholder="What are you working on?" value={reqNote}
                  onChange={(e) => setReqNote(e.target.value)}
                  style={{ height: 46, padding: '0 16px', background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 12, fontSize: 14, color: 'var(--ink)', fontFamily: 'inherit', outline: 'none' }} />
              </div>
              {reqError && <div style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid var(--peach)', background: 'rgba(245,92,122,0.06)', fontSize: 14, color: 'var(--peach)' }}>{reqError}</div>}
              <button type="submit" disabled={reqSubmitting || !reqAmount} className="av-btn av-btn-primary" style={{ alignSelf: 'flex-start' }}>
                {reqSubmitting ? <><SpinnerIcon /> Submitting…</> : 'Submit request →'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ── Invoices ── */}
      {tab === 'invoices' && (
        <div className="av-card" style={{ padding: 0 }}>
          {!requests?.items.length ? (
            <div style={{ padding: '40px 24px', textAlign: 'center', color: 'var(--mute)', fontSize: 14 }}>No credit requests yet.</div>
          ) : requests.items.map((r, i) => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 24px', borderBottom: i < (requests.items.length - 1) ? '1px solid var(--line)' : 'none' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLOR[r.status] ?? 'var(--mute)', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontWeight: 600, fontSize: 14, margin: 0 }}>{r.creditsRequested} credits requested</p>
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
      )}

      {/* ── Credit Activity ── */}
      {tab === 'activity' && (
        <div className="av-card" style={{ padding: 0 }}>
          {!credits?.recent.length ? (
            <div style={{ padding: '40px 24px', textAlign: 'center', color: 'var(--mute)', fontSize: 14 }}>No activity yet.</div>
          ) : credits.recent.map((r, i) => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 24px', borderBottom: i < (credits.recent.length - 1) ? '1px solid var(--line)' : 'none' }}>
              <div style={{
                width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                background: r.delta > 0 ? 'var(--mint-soft)' : 'rgba(245,92,122,0.08)',
                display: 'grid', placeItems: 'center',
                color: r.delta > 0 ? 'var(--mint)' : 'var(--peach)', fontWeight: 700, fontSize: 14,
              }}>
                {r.delta > 0 ? '+' : '−'}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontWeight: 600, fontSize: 14, margin: 0, color: 'var(--ink)' }}>{r.reason}</p>
                <p style={{ fontSize: 12, color: 'var(--mute)', margin: '2px 0 0' }}>{new Date(r.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
              </div>
              <span style={{ fontWeight: 700, fontSize: 16, color: r.delta > 0 ? 'var(--mint)' : 'var(--peach)', fontVariantNumeric: 'tabular-nums' }}>
                {r.delta > 0 ? '+' : ''}{r.delta}
              </span>
            </div>
          ))}
        </div>
      )}

    </div>
  );
}
