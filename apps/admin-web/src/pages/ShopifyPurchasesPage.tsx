import { useCallback, useEffect, useMemo, useState } from 'react';
import { SearchableSelect } from '../components/SearchableSelect';
import { useAuth } from '../context/AuthContext';
import { useCloseOverlay } from '../hooks/use-close-overlay';
import { useUrlState } from '../hooks/use-url-state';
import { apiErrorMessage, apiFetch } from '../lib/data';
import type { PackPurchase, PurchasePaymentStatus } from '../types';

interface Props {
  toast: (opts: { kind?: 'error'; title: string; body?: string }) => void;
}

type Filter = 'attention' | 'all' | PurchasePaymentStatus;
type ReviewAction = 'PAID' | 'NOT_RECEIVED' | 'AUTO' | 'NOTE';

const FILTER_OPTIONS: { id: Filter; label: string }[] = [
  { id: 'attention', label: 'Needs attention' },
  { id: 'all', label: 'All purchases' },
  { id: 'UNVERIFIED', label: 'Unverified (granted, awaiting confirmation)' },
  { id: 'NOT_RECEIVED', label: 'Not received' },
  { id: 'PAID', label: 'Paid' },
  { id: 'NOT_REQUIRED', label: 'Not tracked' },
  { id: 'AWAITING', label: 'Held — awaiting payment' },
  { id: 'UNPAID', label: 'Held — unpaid' },
];

const STATUS_LABEL: Record<PurchasePaymentStatus, string> = {
  NOT_REQUIRED: 'Not tracked',
  UNVERIFIED: 'Unverified',
  PAID: 'Paid',
  NOT_RECEIVED: 'Not received',
  AWAITING: 'Held — awaiting',
  UNPAID: 'Held — unpaid',
};

function statusBadgeClass(s: PurchasePaymentStatus): string {
  if (s === 'PAID') return 'badge success';
  if (s === 'NOT_RECEIVED' || s === 'UNPAID') return 'badge danger';
  if (s === 'UNVERIFIED' || s === 'AWAITING') return 'badge warn';
  return 'badge';
}

function when(value: string | null): string {
  return value ? new Date(value).toLocaleString() : '—';
}

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Every Shopify credit-pack purchase across all stores, with Shopify's charge
 * state and our payment-confirmation state side by side. Credits are granted at
 * approval; this is where an admin sees which approvals Shopify never collected
 * and records a decision (status override + note). Nothing here moves credits.
 */
export default function ShopifyPurchasesPage({ toast }: Props) {
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('credits.write');

  const [purchaseParam, setPurchaseParam] = useUrlState('purchase');
  const closePurchase = useCloseOverlay(['purchase']);
  const [reviewParam, setReviewParam] = useUrlState('review');
  const closeReview = useCloseOverlay(['review']);

  // Filters are how the list is sliced, not navigation, so they stay local state.
  const [filter, setFilter] = useState<Filter>('attention');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const [rows, setRows] = useState<PackPurchase[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [checkingId, setCheckingId] = useState<string | null>(null);

  const [action, setAction] = useState<ReviewAction>('PAID');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(
    async (cursor?: string) => {
      if (cursor) setLoadingMore(true);
      else setLoading(true);
      try {
        const params = new URLSearchParams({ limit: '50' });
        if (filter === 'attention') params.set('needsAttention', 'true');
        else if (filter !== 'all') params.set('paymentStatus', filter);
        if (query) params.set('q', query);
        if (from) params.set('from', `${from}T00:00:00.000Z`);
        if (to) params.set('to', `${to}T23:59:59.999Z`);
        if (cursor) params.set('cursor', cursor);
        const data = await apiFetch<{ purchases: PackPurchase[]; nextCursor: string | null }>(
          `/admin/shopify/purchases?${params}`,
        );
        setRows((prev) => (cursor ? [...prev, ...data.purchases] : data.purchases));
        setNextCursor(data.nextCursor);
      } catch (err) {
        toast({
          kind: 'error',
          title: 'Failed to load purchases',
          body: apiErrorMessage(err, 'Please try again.'),
        });
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [filter, query, from, to, toast],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const selected = useMemo(
    () => rows.find((r) => r.id === purchaseParam) ?? null,
    [rows, purchaseParam],
  );
  const reviewing = useMemo(
    () => rows.find((r) => r.id === reviewParam) ?? null,
    [rows, reviewParam],
  );

  async function checkPayment(id: string) {
    setCheckingId(id);
    try {
      const res = await apiFetch<{ paymentStatus: string }>(
        `/admin/shopify/purchases/${id}/check-payment`,
        { method: 'POST' },
      );
      toast({ title: `Payment status: ${res.paymentStatus}` });
      await load();
    } catch (err) {
      toast({
        kind: 'error',
        title: 'Payment check failed',
        body: apiErrorMessage(err, 'Please try again.'),
      });
    } finally {
      setCheckingId(null);
    }
  }

  function openReview(row: PackPurchase) {
    setAction(row.paymentStatusSource === 'MANUAL' ? 'AUTO' : 'PAID');
    setNote('');
    setReviewParam(row.id);
  }

  async function submitReview() {
    if (!reviewing) return;
    setSaving(true);
    try {
      await apiFetch(`/admin/shopify/purchases/${reviewing.id}/payment-review`, {
        method: 'POST',
        body: JSON.stringify({
          status: action === 'NOTE' ? undefined : action,
          note: note.trim(),
        }),
      });
      toast({ title: 'Review saved' });
      closeReview();
      await load();
    } catch (err) {
      toast({
        kind: 'error',
        title: 'Failed to save review',
        body: apiErrorMessage(err, 'Please try again.'),
      });
    } finally {
      setSaving(false);
    }
  }

  const noteValid = note.trim().length >= 3 && note.trim().length <= 500;
  const canCheck = (r: PackPurchase) =>
    canWrite &&
    ((r.paymentStatus === 'UNVERIFIED' || r.paymentStatus === 'NOT_RECEIVED'
      ? r.paymentStatusSource === 'AUTO'
      : false) ||
      r.paymentStatus === 'AWAITING' ||
      r.paymentStatus === 'UNPAID');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="page-head">
        <div>
          <h1 style={{ margin: 0 }}>Pack purchases</h1>
          <div className="sub" style={{ marginTop: 4 }}>
            Credits are granted when a merchant approves a charge. This page shows whether Shopify
            actually collected the money.
          </div>
        </div>
      </div>

      <div className="card">
        <div
          className="card-body"
          style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}
        >
          <div style={{ minWidth: 260 }}>
            <label className="sub" htmlFor="pp-filter">
              Show
            </label>
            <SearchableSelect
              id="pp-filter"
              ariaLabel="Payment filter"
              options={FILTER_OPTIONS}
              value={filter}
              onChange={(id) => setFilter((id || 'attention') as Filter)}
            />
          </div>
          <div>
            <label className="sub" htmlFor="pp-store">
              Store
            </label>
            <input
              id="pp-store"
              className="input sm"
              placeholder="shop domain contains…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setQuery(search.trim());
              }}
              onBlur={() => setQuery(search.trim())}
            />
          </div>
          <div>
            <label className="sub" htmlFor="pp-from">
              From
            </label>
            <input
              id="pp-from"
              type="date"
              className="input sm"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div>
            <label className="sub" htmlFor="pp-to">
              To
            </label>
            <input
              id="pp-to"
              type="date"
              className="input sm"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-body">
          {loading ? (
            <p style={{ color: 'var(--muted)', fontSize: 13 }}>Loading…</p>
          ) : rows.length === 0 ? (
            <p style={{ color: 'var(--muted)', fontSize: 13 }}>
              {filter === 'attention' ? 'Nothing needs attention.' : 'No purchases match.'}
            </p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Store</th>
                    <th>Pack</th>
                    <th style={{ textAlign: 'right' }}>Credits</th>
                    <th>Payment</th>
                    <th>Note</th>
                    <th>Approved</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.id}
                      style={{ cursor: 'pointer' }}
                      onClick={() => setPurchaseParam(r.id)}
                    >
                      <td>{r.shopDomain}</td>
                      <td>
                        {r.packId} · {dollars(r.priceUsdCents)}
                      </td>
                      <td style={{ textAlign: 'right' }}>{r.credits.toLocaleString()}</td>
                      <td>
                        <span className={statusBadgeClass(r.paymentStatus)}>
                          {STATUS_LABEL[r.paymentStatus]}
                        </span>
                        {r.paymentStatusSource === 'MANUAL' && (
                          <span className="badge" style={{ marginLeft: 6 }}>
                            Manual
                          </span>
                        )}
                      </td>
                      <td
                        style={{
                          maxWidth: 220,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {r.paymentNote ?? '—'}
                      </td>
                      <td>{when(r.createdAt)}</td>
                      <td onClick={(e) => e.stopPropagation()} style={{ whiteSpace: 'nowrap' }}>
                        {canCheck(r) && (
                          <button
                            type="button"
                            className="btn sm ghost"
                            disabled={checkingId === r.id}
                            onClick={() => void checkPayment(r.id)}
                          >
                            {checkingId === r.id ? 'Checking…' : 'Check payment'}
                          </button>
                        )}{' '}
                        {canWrite &&
                          (r.paymentStatus === 'AWAITING' || r.paymentStatus === 'UNPAID' ? null : (
                            <button type="button" className="btn sm" onClick={() => openReview(r)}>
                              Review
                            </button>
                          ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {nextCursor && (
            <button
              type="button"
              className="btn ghost"
              style={{ marginTop: 12 }}
              disabled={loadingMore}
              onClick={() => void load(nextCursor)}
            >
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          )}
        </div>
      </div>

      {selected && (
        <div className="modal-overlay" onClick={closePurchase}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>
                {selected.packId} · {selected.shopDomain}
              </h3>
            </div>
            <div className="modal-body" style={{ display: 'grid', gap: 8, fontSize: 13 }}>
              <div>
                <strong>Charge:</strong> {selected.status} · {selected.shopifyChargeId ?? '—'}
              </div>
              <div>
                <strong>Approved:</strong> {when(selected.createdAt)}
              </div>
              <div>
                <strong>Credits granted:</strong>{' '}
                {selected.creditsGrantedAt
                  ? `${selected.credits.toLocaleString()} at ${when(selected.creditsGrantedAt)}`
                  : 'no ledger entry'}
              </div>
              <div>
                <strong>Payment:</strong> {STATUS_LABEL[selected.paymentStatus]} (
                {selected.paymentStatusSource === 'MANUAL' ? 'set by an admin' : 'automatic'})
              </div>
              <div>
                <strong>Sale recorded by Shopify:</strong> {when(selected.paidAt)}
              </div>
              <div>
                <strong>Note:</strong> {selected.paymentNote ?? '—'}
              </div>
              <div>
                <strong>Last reviewed:</strong>{' '}
                {selected.paymentFlaggedAt
                  ? `${when(selected.paymentFlaggedAt)} by ${selected.flaggedByName ?? selected.flaggedByEmail ?? 'unknown'}`
                  : '—'}
              </div>
            </div>
            <div className="modal-foot">
              <button type="button" className="btn ghost" onClick={closePurchase}>
                Close
              </button>
              {canWrite &&
                selected.paymentStatus !== 'AWAITING' &&
                selected.paymentStatus !== 'UNPAID' && (
                  <button type="button" className="btn" onClick={() => openReview(selected)}>
                    Review
                  </button>
                )}
            </div>
          </div>
        </div>
      )}

      {reviewing && (
        <div className="modal-overlay" onClick={closeReview}>
          <div className="modal confirm" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Review payment — {reviewing.shopDomain}</h3>
            </div>
            <div className="modal-body" style={{ display: 'grid', gap: 12 }}>
              <p style={{ margin: 0, fontSize: 13 }}>
                This records your decision only. It does not add or remove any credits.
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {(
                  [
                    ['PAID', 'Mark paid'],
                    ['NOT_RECEIVED', 'Mark not received'],
                    ...(reviewing.paymentStatusSource === 'MANUAL'
                      ? ([['AUTO', 'Clear override']] as [ReviewAction, string][])
                      : []),
                    ['NOTE', 'Note only'],
                  ] as [ReviewAction, string][]
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={action === value ? 'btn' : 'btn ghost'}
                    aria-pressed={action === value}
                    onClick={() => setAction(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div>
                <label className="sub" htmlFor="pp-note">
                  Note (required, 3–500 characters)
                </label>
                <textarea
                  id="pp-note"
                  className="input"
                  rows={4}
                  maxLength={500}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. Invoice shows Failed in the merchant's billing; contacted them"
                  style={{ width: '100%' }}
                />
              </div>
            </div>
            <div className="modal-foot">
              <button type="button" className="btn ghost" onClick={closeReview} disabled={saving}>
                Cancel
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => void submitReview()}
                disabled={saving || !noteValid}
              >
                {saving ? 'Saving…' : 'Save review'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
