'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle, Clock, XCircle } from 'lucide-react';

interface CreditsResponse { balance: number; recent: { id: string; delta: number; reason: string; createdAt: string }[] }
interface CreditRequest { id: string; creditsRequested: number; note: string | null; status: string; createdAt: string; creditsApproved: number | null }

const STATUS_ICON: Record<string, React.ReactNode> = {
  pending: <Clock className="h-4 w-4 text-muted-foreground" />,
  approved: <CheckCircle className="h-4 w-4 text-green-700" />,
  rejected: <XCircle className="h-4 w-4 text-destructive" />,
};

export default function CreditsPage() {
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
    setSubmitting(true);
    setError('');
    setSuccess(false);
    try {
      await api.post('/v1/credits/request', { creditsRequested: amt, note: note || undefined });
      setSuccess(true);
      setAmount('');
      setNote('');
      void qc.invalidateQueries({ queryKey: ['credit-requests'] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const PACKAGES = [
    { credits: 10, label: '10 credits', desc: '10 try-ons' },
    { credits: 50, label: '50 credits', desc: '50 try-ons · best value' },
    { credits: 100, label: '100 credits', desc: '100 try-ons' },
  ];

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="font-hand text-4xl">Credits</h1>
        <p className="mt-1 font-body text-sm text-muted-foreground">Request credits from the admin to run virtual try-ons.</p>
      </div>

      {/* Current balance */}
      <div className="sketch-card p-6">
        <p className="font-hand text-[17px] text-muted-foreground">Current balance</p>
        <p className="font-hand text-6xl mt-1">
          <span className="text-primary">{credits?.balance ?? '—'}</span>
          <span className="text-2xl text-muted-foreground ml-2">credits</span>
        </p>
        <p className="font-body text-xs text-muted-foreground mt-2">1 credit = 1 virtual try-on generation</p>
      </div>

      {/* Credit packages (informational) */}
      <div>
        <h2 className="font-hand text-2xl mb-4">Packages</h2>
        <div className="grid grid-cols-3 gap-4">
          {PACKAGES.map((p) => (
            <button
              key={p.credits}
              type="button"
              onClick={() => setAmount(String(p.credits))}
              className={[
                'sketch-card p-4 text-left transition-all hover:-translate-x-0.5 hover:-translate-y-0.5',
                amount === String(p.credits) ? 'ring-2 ring-primary' : '',
              ].join(' ')}
            >
              <p className="font-hand text-3xl text-primary">{p.credits}</p>
              <p className="font-hand text-lg mt-0.5">{p.label}</p>
              <p className="font-body text-xs text-muted-foreground mt-1">{p.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Request form */}
      <div className="sketch-card p-6">
        <h2 className="font-hand text-2xl mb-4">Request Credits</h2>
        <p className="font-body text-sm text-muted-foreground mb-5">
          Submit a request to the admin. They will review and add credits to your account.
        </p>

        {success && (
          <div className="mb-4 rounded border border-green-700 bg-green-50 px-3 py-2 font-body text-sm text-green-800 flex items-center gap-2">
            <CheckCircle className="h-4 w-4" />
            Request submitted — admin will review shortly.
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="font-hand text-[17px] block">Credits requested</label>
            <Input
              type="number"
              min={1}
              max={1000}
              placeholder="e.g. 50"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label className="font-hand text-[17px] block">Note <span className="font-body text-xs text-muted-foreground">(optional)</span></label>
            <Input
              type="text"
              placeholder="Tell us what you're working on…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          {error && (
            <p className="rounded border border-destructive bg-destructive/10 px-3 py-2 font-body text-sm text-destructive">{error}</p>
          )}
          <Button type="submit" disabled={submitting || !amount}>
            {submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Submitting…</> : 'Submit request →'}
          </Button>
        </form>
      </div>

      {/* Past requests */}
      {requests && requests.items.length > 0 && (
        <div>
          <h2 className="font-hand text-2xl mb-4">Your Requests</h2>
          <div className="sketch-card divide-y divide-foreground/10" style={{ padding: 0 }}>
            {requests.items.map((r) => (
              <div key={r.id} className="flex items-center gap-4 px-5 py-4">
                <div>{STATUS_ICON[r.status] ?? <Clock className="h-4 w-4" />}</div>
                <div className="flex-1 min-w-0">
                  <p className="font-hand text-lg">{r.creditsRequested} credits requested</p>
                  {r.note && <p className="font-body text-xs text-muted-foreground truncate">{r.note}</p>}
                  <p className="font-body text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleDateString()}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge variant={r.status === 'approved' ? 'success' : r.status === 'rejected' ? 'destructive' : 'warning'}>
                    {r.status}
                  </Badge>
                  {r.creditsApproved != null && r.status === 'approved' && (
                    <span className="font-body text-xs text-muted-foreground">+{r.creditsApproved} added</span>
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
