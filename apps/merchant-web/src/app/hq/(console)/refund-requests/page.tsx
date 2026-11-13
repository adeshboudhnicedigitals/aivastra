'use client';
import { REFUND_REASON_LABELS } from '@aivastra/types';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useHq } from '@/components/hq/hq-session';
import {
  EmptyBox,
  ErrorBox,
  FilterTabs,
  NoAccess,
  PageHead,
  td,
  th,
} from '@/components/hq/list-parts';
import { btn, Card, Pill, Skeleton, type Tone } from '@/components/hq/ui';
import { C, M } from '@/components/tokens';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { hqFetch } from '@/lib/hq-api';

// A copy of admin-web's Refund requests page for the team console. The admin page is untouched;
// both call the same /admin/refund-requests routes (credits.read to view, credits.write to decide).

type Status = 'PENDING' | 'APPROVED' | 'REJECTED';
type Filter = Status | 'ALL';
const FILTERS = [
  { k: 'PENDING', l: 'Pending' },
  { k: 'APPROVED', l: 'Approved' },
  { k: 'REJECTED', l: 'Rejected' },
  { k: 'ALL', l: 'All requests' },
] as const;

type RefundRequest = {
  id: string;
  userEmail: string;
  credits: number;
  reasonCode: string;
  note: string | null;
  status: Status;
  adminNote: string | null;
  autoApproved: boolean;
  reviewedAt: string | null;
  createdAt: string;
  downloadedAt: string | null;
  imageUrl: string;
  previewUrl: string;
};
type RefundPage = { requests: RefundRequest[]; nextCursor: string | null };
type AutoApprove = { enabled: boolean; dailyCap: number };

const REASON: Record<string, string> = REFUND_REASON_LABELS;
const STATUS_TONE: Record<Status, Tone> = { PENDING: 'warn', APPROVED: 'ok', REJECTED: 'bad' };
const STATUS_LABEL: Record<Status, string> = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};
const when = (v: string | null) =>
  v ? new Date(v).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const msg = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

export default function RefundRequestsPage() {
  const { can } = useHq();
  if (!can('credits.read')) return <NoAccess what="refund requests" />;
  return <Refunds canWrite={can('credits.write')} />;
}

function Refunds({ canWrite }: { canWrite: boolean }) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>('PENDING');
  const [openId, setOpenId] = useState<string | null>(null);

  const list = useInfiniteQuery({
    queryKey: ['hq', 'refunds', filter],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams({ limit: '50' });
      if (filter !== 'ALL') p.set('status', filter);
      if (pageParam) p.set('cursor', pageParam);
      return hqFetch<RefundPage>(`/admin/refund-requests?${p}`);
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = list.data?.pages.flatMap((p) => p.requests) ?? [];
  // A stale id (decided and filtered out) simply closes the dialog.
  const selected = rows.find((r) => r.id === openId) ?? null;

  return (
    <div>
      <PageHead
        title="Refund requests"
        lede="Customers asking for credits back on a generated image. Credits move only when you approve."
      />
      <AutoApproveCard canWrite={canWrite} />

      <FilterTabs label="Request status" value={filter} options={FILTERS} onChange={setFilter} />

      {list.isError ? (
        <ErrorBox what="refund requests" error={list.error} onRetry={() => void list.refetch()} />
      ) : list.isPending ? (
        <div style={{ display: 'grid', gap: 10 }} aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} h={72} />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyBox>{filter === 'PENDING' ? 'No pending requests.' : 'No requests match.'}</EmptyBox>
      ) : (
        <>
          <div className="hq-table hq-card" style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <caption className="sr-only">Refund requests</caption>
              <thead>
                <tr style={{ color: C.mid, fontSize: 12 }}>
                  <th scope="col" style={th}>
                    Image
                  </th>
                  <th scope="col" style={th}>
                    Customer
                  </th>
                  <th scope="col" style={th}>
                    Reason
                  </th>
                  <th scope="col" style={{ ...th, textAlign: 'right' }}>
                    Credits
                  </th>
                  <th scope="col" style={th}>
                    Status
                  </th>
                  <th scope="col" style={th}>
                    Requested
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="hq-row" style={{ borderTop: `1px solid ${C.border}` }}>
                    <td style={td}>
                      {/* biome-ignore lint/performance/noImgElement: presigned storage URL */}
                      <img
                        src={r.previewUrl}
                        alt=""
                        width={48}
                        height={64}
                        style={{ objectFit: 'cover', borderRadius: 6, display: 'block' }}
                      />
                    </td>
                    <td style={td}>
                      <button
                        type="button"
                        onClick={() => setOpenId(r.id)}
                        style={{
                          all: 'unset',
                          cursor: 'pointer',
                          color: C.text,
                          fontWeight: 700,
                          overflowWrap: 'anywhere',
                        }}
                      >
                        {r.userEmail}
                      </button>
                    </td>
                    <td style={td}>{REASON[r.reasonCode] ?? r.reasonCode}</td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      {r.credits.toLocaleString('en-IN')}
                    </td>
                    <td style={td}>
                      <StatusPills r={r} />
                    </td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{when(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="hq-cards" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {rows.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className="hq-card hq-card--link"
                  onClick={() => setOpenId(r.id)}
                  style={{
                    display: 'flex',
                    gap: 12,
                    width: '100%',
                    padding: 12,
                    textAlign: 'left',
                    fontFamily: 'inherit',
                    color: C.text,
                    cursor: 'pointer',
                  }}
                >
                  {/* biome-ignore lint/performance/noImgElement: presigned storage URL */}
                  <img
                    src={r.previewUrl}
                    alt=""
                    width={48}
                    height={64}
                    style={{ objectFit: 'cover', borderRadius: 6, flex: 'none' }}
                  />
                  <span style={{ minWidth: 0, display: 'grid', gap: 4 }}>
                    <strong style={{ overflowWrap: 'anywhere' }}>{r.userEmail}</strong>
                    <span style={{ fontSize: 13, color: C.mid }}>
                      {REASON[r.reasonCode] ?? r.reasonCode} · {r.credits.toLocaleString('en-IN')}{' '}
                      credits
                    </span>
                    <StatusPills r={r} />
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {list.hasNextPage && (
            <button
              type="button"
              style={{ ...btn.base, marginTop: 14 }}
              disabled={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              {list.isFetchingNextPage ? 'Loading…' : 'Load more'}
            </button>
          )}
        </>
      )}

      <ReviewDialog
        key={selected?.id ?? 'none'}
        request={selected}
        canWrite={canWrite}
        onClose={() => setOpenId(null)}
        onDecided={() => {
          setOpenId(null);
          void qc.invalidateQueries({ queryKey: ['hq', 'refunds'] });
        }}
      />
    </div>
  );
}

function StatusPills({ r }: { r: RefundRequest }) {
  return (
    <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
      <Pill tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Pill>
      {r.autoApproved && <Pill tone="muted">Auto</Pill>}
    </span>
  );
}

function AutoApproveCard({ canWrite }: { canWrite: boolean }) {
  const qc = useQueryClient();
  const [cap, setCap] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cfg = useQuery({
    queryKey: ['hq', 'refunds', 'auto-approve'],
    queryFn: async () => {
      const c = await hqFetch<AutoApprove>('/admin/refund-requests/auto-approve');
      setCap(String(c.dailyCap));
      return c;
    },
  });
  const save = useMutation({
    mutationFn: (patch: Partial<AutoApprove>) =>
      hqFetch<AutoApprove>('/admin/refund-requests/auto-approve', {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onMutate: () => setError(null),
    onSuccess: (c) => {
      qc.setQueryData(['hq', 'refunds', 'auto-approve'], c);
      setCap(String(c.dailyCap));
      setConfirming(false);
    },
    onError: (e) => {
      setConfirming(false);
      if (cfg.data) setCap(String(cfg.data.dailyCap));
      setError(msg(e, 'Could not save the setting.'));
    },
  });

  const c = cfg.data;
  const commitCap = () => {
    if (!c || !canWrite || save.isPending) return;
    const n = Number(cap);
    if (!Number.isInteger(n) || n < 1 || n > 100) {
      setCap(String(c.dailyCap));
      setError('Enter a whole number of requests between 1 and 100.');
      return;
    }
    if (n !== c.dailyCap) save.mutate({ dailyCap: n });
  };

  return (
    <div style={{ marginBottom: 16 }}>
      <Card title="Auto-approve">
        {cfg.isError ? (
          <p style={{ margin: 0, fontSize: 14, color: C.mid }}>
            Could not load this setting.{' '}
            <button type="button" style={btn.base} onClick={() => void cfg.refetch()}>
              Try again
            </button>
          </p>
        ) : !c ? (
          <Skeleton h={40} />
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14 }}>
              <input
                type="checkbox"
                checked={c.enabled}
                disabled={!canWrite || save.isPending}
                onChange={(e) => {
                  // Turning it on moves money without review, so it asks first; off is harmless.
                  if (e.target.checked) setConfirming(true);
                  else save.mutate({ enabled: false });
                }}
                style={{ width: 18, height: 18 }}
              />
              <span style={{ fontWeight: 600, color: C.text }}>
                Approve eligible requests automatically
              </span>
            </label>
            <div style={{ maxWidth: 260 }}>
              <label htmlFor="rr-cap" style={{ fontSize: 12, color: C.mid }}>
                Most per customer per day
              </label>
              <input
                id="rr-cap"
                type="number"
                min={1}
                max={100}
                step={1}
                value={cap}
                disabled={!canWrite || save.isPending}
                onChange={(e) => setCap(e.target.value)}
                onBlur={commitCap}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                }}
                style={{
                  width: '100%',
                  height: 40,
                  padding: '0 12px',
                  borderRadius: 8,
                  border: `1px solid ${C.border2}`,
                  background: C.field,
                  color: C.text,
                  fontFamily: 'inherit',
                  fontSize: 14,
                }}
              />
            </div>
            <p style={{ margin: 0, fontSize: 13, color: C.mid }}>
              {c.enabled
                ? 'On: eligible requests are approved at once and the credits go back immediately.'
                : 'Off: every request waits here for a person to decide.'}
              {!canWrite && ' You can view this setting but not change it.'}
            </p>
            {error && (
              <div role="alert" style={{ color: M.danger, fontSize: 14 }}>
                {error}
              </div>
            )}
          </div>
        )}
      </Card>
      <ConfirmDialog
        open={confirming}
        title="Turn on auto-approve?"
        body={`New eligible refund requests will be approved at once and credits returned without review, up to ${cap || c?.dailyCap || 5} per customer per day. Every change is recorded in the audit log.`}
        confirmLabel="Turn on auto-approve"
        busy={save.isPending}
        onConfirm={() => save.mutate({ enabled: true })}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}

function ReviewDialog({
  request: r,
  canWrite,
  onClose,
  onDecided,
}: {
  request: RefundRequest | null;
  canWrite: boolean;
  onClose: () => void;
  onDecided: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Native <dialog>: focus trap, Escape and the backdrop come with showModal().
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (r && !d.open) d.showModal();
    if (!r && d.open) d.close();
  }, [r]);

  const decide = useMutation({
    mutationFn: (decision: 'approve' | 'reject') =>
      hqFetch(`/admin/refund-requests/${r?.id}/${decision}`, {
        method: 'POST',
        body: JSON.stringify({ adminNote: note.trim() || undefined }),
      }),
    onMutate: () => setError(null),
    onSuccess: onDecided,
    onError: (e) => setError(msg(e, 'Could not save the decision.')),
  });

  const pending = r?.status === 'PENDING';
  const noteOk = note.trim().length >= 3;

  return (
    <dialog
      ref={ref}
      aria-labelledby="rr-title"
      onClose={onClose}
      style={{
        width: 'min(520px, calc(100vw - 32px))',
        padding: 0,
        border: `1px solid ${C.border}`,
        borderRadius: 14,
        background: C.card,
        color: C.text,
      }}
    >
      {r && (
        <div style={{ padding: 20, display: 'grid', gap: 12, fontSize: 14 }}>
          <h2 id="rr-title" style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>
            {r.credits.toLocaleString('en-IN')} credits · {r.userEmail}
          </h2>
          <a href={r.imageUrl} target="_blank" rel="noreferrer">
            {/* biome-ignore lint/performance/noImgElement: presigned storage URL */}
            <img
              src={r.previewUrl}
              alt="Generated result (opens full size)"
              style={{ maxWidth: '100%', maxHeight: 340, borderRadius: 8 }}
            />
          </a>
          <div>
            <StatusPills r={r} />
          </div>
          <div>
            <strong>Reason:</strong> {REASON[r.reasonCode] ?? r.reasonCode}
          </div>
          <div>
            <strong>Customer note:</strong> {r.note ?? '—'}
          </div>
          <div>
            <strong>Requested:</strong> {when(r.createdAt)}
          </div>
          {r.downloadedAt && (
            <div
              role="note"
              style={{ background: M.dangerTint, color: M.danger, padding: 10, borderRadius: 8 }}
            >
              The customer downloaded this image ({when(r.downloadedAt)}). Reject it; do not refund.
            </div>
          )}
          {!pending && (
            <>
              <div>
                <strong>Decided:</strong> {when(r.reviewedAt)}
              </div>
              <div>
                <strong>Note sent:</strong> {r.adminNote ?? '—'}
              </div>
            </>
          )}
          {canWrite && pending && (
            <div>
              <label htmlFor="rr-note" style={{ fontSize: 12, color: C.mid }}>
                Note to the customer (needed to reject, 3–500 characters; emailed to them)
              </label>
              <textarea
                id="rr-note"
                rows={3}
                maxLength={500}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                style={{
                  width: '100%',
                  padding: 10,
                  borderRadius: 8,
                  border: `1px solid ${C.border2}`,
                  background: C.field,
                  color: C.text,
                  fontFamily: 'inherit',
                  fontSize: 14,
                }}
              />
            </div>
          )}
          {error && (
            <div role="alert" style={{ color: M.danger }}>
              {error}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button type="button" style={btn.base} onClick={onClose} disabled={decide.isPending}>
              Close
            </button>
            {canWrite && pending && (
              <>
                <button
                  type="button"
                  style={{ ...btn.base, opacity: noteOk ? 1 : 0.5 }}
                  disabled={decide.isPending || !noteOk}
                  onClick={() => decide.mutate('reject')}
                >
                  Reject
                </button>
                <button
                  type="button"
                  style={{ ...btn.primary, opacity: r.downloadedAt ? 0.5 : 1 }}
                  disabled={decide.isPending || !!r.downloadedAt}
                  onClick={() => decide.mutate('approve')}
                >
                  {decide.isPending
                    ? 'Saving…'
                    : `Approve and refund ${r.credits.toLocaleString('en-IN')}`}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </dialog>
  );
}
