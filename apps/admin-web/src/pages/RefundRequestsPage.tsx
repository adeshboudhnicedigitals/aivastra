import { REFUND_REASON_LABELS } from '@aivastra/types';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { SearchableSelect } from '../components/SearchableSelect';
import { useAuth } from '../context/AuthContext';
import { useCloseOverlay } from '../hooks/use-close-overlay';
import { useUrlState } from '../hooks/use-url-state';
import { apiErrorMessage, apiFetch } from '../lib/data';
import type { RefundRequest, RefundRequestStatus } from '../types';

interface Props {
  toast: (opts: { kind?: 'error'; title: string; body?: string }) => void;
}

type Filter = 'ALL' | RefundRequestStatus;

const FILTER_OPTIONS: { id: Filter; label: string }[] = [
  { id: 'PENDING', label: 'Pending' },
  { id: 'APPROVED', label: 'Approved' },
  { id: 'REJECTED', label: 'Rejected' },
  { id: 'ALL', label: 'All requests' },
];

// Widened so a reason code the API adds later still type-checks and falls back to the raw code.
const REASON_LABEL: Record<string, string> = REFUND_REASON_LABELS;

function badgeClass(s: RefundRequestStatus): string {
  if (s === 'APPROVED') return 'badge success';
  if (s === 'REJECTED') return 'badge danger';
  return 'badge warn';
}

function when(value: string | null): string {
  return value ? new Date(value).toLocaleString() : '—';
}

/**
 * Customer requests to get credits back for a generated image. Approving credits the
 * snapshotted amount to the customer (once, audited); rejecting records the reason and
 * moves no credits. The customer is emailed either way.
 */
export default function RefundRequestsPage({ toast }: Props) {
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('credits.write');

  // The open request is navigation (shareable link); the status filter is just how the
  // list is sliced, so it stays local state (docs/admin-url-routing-standard.md).
  const [requestParam, setRequestParam] = useUrlState('request');
  const closeRequest = useCloseOverlay(['request']);

  const [filter, setFilter] = useState<Filter>('PENDING');
  const [rows, setRows] = useState<RefundRequest[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const [adminNote, setAdminNote] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(
    async (cursor?: string) => {
      if (cursor) setLoadingMore(true);
      else setLoading(true);
      try {
        const params = new URLSearchParams({ limit: '50' });
        if (filter !== 'ALL') params.set('status', filter);
        if (cursor) params.set('cursor', cursor);
        const data = await apiFetch<{ requests: RefundRequest[]; nextCursor: string | null }>(
          `/admin/refund-requests?${params}`,
        );
        setRows((prev) => (cursor ? [...prev, ...data.requests] : data.requests));
        setNextCursor(data.nextCursor);
      } catch (err) {
        toast({
          kind: 'error',
          title: 'Failed to load refund requests',
          body: apiErrorMessage(err, 'Please try again.'),
        });
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [filter, toast],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // A stale id in the URL (decided and filtered out, or never existed) just shows the list.
  const selected = useMemo(
    () => rows.find((r) => r.id === requestParam) ?? null,
    [rows, requestParam],
  );

  // The note is emailed to the customer on decision, so it must never follow the admin to a
  // different request (back/forward, pasted ?request= link) — reset on every id change.
  useEffect(() => {
    setAdminNote('');
  }, [selected?.id]);

  function open(row: RefundRequest) {
    setRequestParam(row.id);
  }

  async function decide(row: RefundRequest, decision: 'approve' | 'reject') {
    setSaving(true);
    try {
      await apiFetch(`/admin/refund-requests/${row.id}/${decision}`, {
        method: 'POST',
        body: JSON.stringify({ adminNote: adminNote.trim() || undefined }),
      });
      toast({
        title:
          decision === 'approve'
            ? `Refunded ${row.credits.toLocaleString()} credits`
            : 'Request rejected',
      });
      closeRequest();
      await load();
    } catch (err) {
      toast({
        kind: 'error',
        title: decision === 'approve' ? 'Failed to approve' : 'Failed to reject',
        body: apiErrorMessage(err, 'Please try again.'),
      });
    } finally {
      setSaving(false);
    }
  }

  const rejectNoteValid = adminNote.trim().length >= 3;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="page-head">
        <div>
          <h1 style={{ margin: 0 }}>Refund requests</h1>
          <div className="sub" style={{ marginTop: 4 }}>
            Customers asking for credits back on a generated image. Credits move only when you
            approve.
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-body" style={{ maxWidth: 320 }}>
          <label className="sub" htmlFor="rr-filter">
            Show
          </label>
          <SearchableSelect
            id="rr-filter"
            ariaLabel="Status filter"
            options={FILTER_OPTIONS}
            value={filter}
            onChange={(id) => setFilter((id || 'PENDING') as Filter)}
          />
        </div>
      </div>

      <div className="card">
        <div className="card-body">
          {loading ? (
            <p style={{ color: 'var(--muted)', fontSize: 13 }}>Loading…</p>
          ) : rows.length === 0 ? (
            <p style={{ color: 'var(--muted)', fontSize: 13 }}>
              {filter === 'PENDING' ? 'No pending requests.' : 'No requests match.'}
            </p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Image</th>
                    <th>Customer</th>
                    <th>Reason</th>
                    <th style={{ textAlign: 'right' }}>Credits</th>
                    <th>Status</th>
                    <th>Requested</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => open(r)}>
                      <td>
                        <img
                          src={r.previewUrl}
                          alt="Generated result"
                          width={48}
                          height={64}
                          style={{ objectFit: 'cover', borderRadius: 6 }}
                        />
                      </td>
                      <td>{r.userEmail}</td>
                      <td>{REASON_LABEL[r.reasonCode] ?? r.reasonCode}</td>
                      <td style={{ textAlign: 'right' }}>{r.credits.toLocaleString()}</td>
                      <td>
                        <span className={badgeClass(r.status)}>{r.status}</span>
                      </td>
                      <td>{when(r.createdAt)}</td>
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
        <div className="modal-overlay" onClick={closeRequest}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>
                {selected.credits.toLocaleString()} credits · {selected.userEmail}
              </h3>
            </div>
            <div className="modal-body" style={{ display: 'grid', gap: 12, fontSize: 13 }}>
              <a href={selected.imageUrl} target="_blank" rel="noreferrer">
                <img
                  src={selected.previewUrl}
                  alt="Generated result (opens full size)"
                  style={{ maxWidth: '100%', maxHeight: 360, borderRadius: 8 }}
                />
              </a>
              <div>
                <strong>Status:</strong>{' '}
                <span className={badgeClass(selected.status)}>{selected.status}</span>
              </div>
              <div>
                <strong>Reason:</strong> {REASON_LABEL[selected.reasonCode] ?? selected.reasonCode}
              </div>
              <div>
                <strong>Customer note:</strong> {selected.note ?? '—'}
              </div>
              <div>
                <strong>Requested:</strong> {when(selected.createdAt)}
              </div>
              {selected.downloadedAt && (
                <div className="badge danger">
                  The customer downloaded this image ({when(selected.downloadedAt)}) — reject, do
                  not refund.
                </div>
              )}
              {selected.status !== 'PENDING' && (
                <>
                  <div>
                    <strong>Decided:</strong> {when(selected.reviewedAt)}
                  </div>
                  <div>
                    <strong>Admin note:</strong> {selected.adminNote ?? '—'}
                  </div>
                </>
              )}
              {canWrite && selected.status === 'PENDING' && (
                <div>
                  <label className="sub" htmlFor="rr-note">
                    Note to the customer (required to reject, 3–500 characters)
                  </label>
                  <textarea
                    id="rr-note"
                    className="input"
                    rows={3}
                    maxLength={500}
                    value={adminNote}
                    onChange={(e) => setAdminNote(e.target.value)}
                    style={{ width: '100%' }}
                  />
                </div>
              )}
            </div>
            <div className="modal-foot">
              <button type="button" className="btn ghost" onClick={closeRequest} disabled={saving}>
                Close
              </button>
              {canWrite && selected.status === 'PENDING' && (
                <>
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={saving || !rejectNoteValid}
                    onClick={() => void decide(selected, 'reject')}
                  >
                    Reject
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={saving || !!selected.downloadedAt}
                    onClick={() => void decide(selected, 'approve')}
                  >
                    {saving ? 'Saving…' : `Approve & refund ${selected.credits.toLocaleString()}`}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
