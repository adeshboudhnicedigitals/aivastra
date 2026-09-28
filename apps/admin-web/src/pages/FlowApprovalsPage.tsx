import { useCallback, useEffect, useState } from 'react';
import { Icon } from '../components/Icons';
import { useAuth } from '../context/AuthContext';
import { useCloseOverlay } from '../hooks/use-close-overlay';
import { useUrlState } from '../hooks/use-url-state';
import { apiErrorMessage, apiFetch } from '../lib/data';

interface ChangeRequestRow {
  id: string;
  changeType: 'create' | 'update';
  targetWorkflowId: string | null;
  targetWorkflowLabel: string | null;
  proposedBy: string;
  proposedByEmail: string;
  proposedByRole: string;
  reason: string;
  previousLimitations: string | null;
  proposedFields: Record<string, unknown>;
  status: 'pending' | 'approved' | 'rejected';
  reviewedBy: string | null;
  reviewedByEmail: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  resultingWorkflowId: string | null;
  resultingWorkflowLabel: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Props {
  toast: (t: { kind?: 'error' | 'success'; title: string; body?: string }) => void;
  onNav: (_page: string, _filter?: { page: string; filter?: string }) => void;
}

const STATUS_COLOR: Record<ChangeRequestRow['status'], string> = {
  pending: '#ca8a04',
  approved: '#16a34a',
  rejected: '#dc2626',
};

function StatusDot({ status }: { status: ChangeRequestRow['status'] }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: STATUS_COLOR[status],
          display: 'inline-block',
        }}
      />
      {status[0].toUpperCase() + status.slice(1)}
    </span>
  );
}

export default function FlowApprovalsPage({ toast }: Props) {
  const { role } = useAuth();
  const isSuperAdmin = role === 'SUPER_ADMIN';
  const [rows, setRows] = useState<ChangeRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailIdParam, setDetailIdParam] = useUrlState('view');
  const closeDetail = useCloseOverlay(['view']);
  const [reviewNote, setReviewNote] = useState('');
  const [jsonExpanded, setJsonExpanded] = useState(false);
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);

  const detail = detailIdParam ? (rows.find((r) => r.id === detailIdParam) ?? null) : null;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<ChangeRequestRow[]>('/admin/workflow-change-requests');
      setRows(data);
    } catch (_e) {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setReviewNote('');
    setJsonExpanded(false);
  }, [detailIdParam]);

  const handleApprove = async () => {
    if (!detail) return;
    setApproving(true);
    try {
      await apiFetch(`/admin/workflow-change-requests/${detail.id}/approve`, {
        method: 'POST',
        body: JSON.stringify(reviewNote.trim() ? { reviewNote: reviewNote.trim() } : {}),
      });
      toast({ kind: 'success', title: 'Change approved and applied' });
      closeDetail();
      void load();
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to approve',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    } finally {
      setApproving(false);
    }
  };

  const handleReject = async () => {
    if (!detail) return;
    if (!reviewNote.trim()) {
      toast({ kind: 'error', title: 'A review note is required to reject' });
      return;
    }
    setRejecting(true);
    try {
      await apiFetch(`/admin/workflow-change-requests/${detail.id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reviewNote: reviewNote.trim() }),
      });
      toast({ title: 'Change rejected' });
      closeDetail();
      void load();
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to reject',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    } finally {
      setRejecting(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="page-head">
        <div>
          <h2 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 600 }}>Flow Approvals</h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)', maxWidth: 640 }}>
            {isSuperAdmin
              ? 'MODERATOR and ADMIN propose new or changed workflows with a reason; nothing takes effect until you approve it here.'
              : 'Track the status of your proposed workflow changes — a SUPER_ADMIN reviews and approves or rejects each one.'}
          </p>
        </div>
      </div>

      {loading ? (
        <div
          style={{ color: 'var(--muted)', fontSize: 13, padding: '32px 0', textAlign: 'center' }}
        >
          Loading…
        </div>
      ) : rows.length === 0 ? (
        <div
          style={{
            border: '1px dashed var(--border)',
            borderRadius: 8,
            padding: '48px 24px',
            textAlign: 'center',
            color: 'var(--muted)',
            fontSize: 13,
          }}
        >
          {isSuperAdmin ? 'No proposals yet.' : "You haven't proposed any workflow changes yet."}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Proposed by</th>
                <th>Replaces/target</th>
                <th>Submitted</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setDetailIdParam(r.id)}>
                  <td>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        padding: '2px 8px',
                        borderRadius: 10,
                        background:
                          r.changeType === 'create'
                            ? 'rgba(37,99,235,0.1)'
                            : 'rgba(139,92,246,0.12)',
                        color: r.changeType === 'create' ? '#1d4ed8' : '#6d28d9',
                      }}
                    >
                      {r.changeType === 'create' ? 'New workflow' : 'Update'}
                    </span>
                  </td>
                  <td>
                    <div style={{ fontWeight: 500 }}>{r.proposedByEmail}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>{r.proposedByRole}</div>
                  </td>
                  <td>{r.targetWorkflowLabel ?? '—'}</td>
                  <td style={{ color: 'var(--muted)', fontSize: 12 }}>
                    {new Date(r.createdAt).toLocaleDateString()}
                  </td>
                  <td>
                    <StatusDot status={r.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detail && (
        <div className="modal-overlay" onClick={closeDetail}>
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            style={{ width: 'min(640px, calc(100vw - 40px))' }}
          >
            <div className="modal-head">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {detail.changeType === 'create' ? 'New workflow' : 'Update workflow'}
                <StatusDot status={detail.status} />
              </h3>
              <button className="btn sm ghost" onClick={closeDetail} style={{ marginLeft: 'auto' }}>
                <Icon.Close />
              </button>
            </div>
            <div
              className="modal-body"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
                maxHeight: '70vh',
                overflowY: 'auto',
                fontSize: 13,
              }}
            >
              <div>
                <strong>{detail.proposedByEmail}</strong> ({detail.proposedByRole}) proposed this on{' '}
                {new Date(detail.createdAt).toLocaleString()}
              </div>
              <div>
                <span style={{ color: 'var(--muted)' }}>Replaces/target: </span>
                {detail.targetWorkflowLabel ?? '—'}
              </div>
              {detail.reviewedByEmail && (
                <div>
                  <span style={{ color: 'var(--muted)' }}>Reviewed by: </span>
                  {detail.reviewedByEmail} on{' '}
                  {detail.reviewedAt ? new Date(detail.reviewedAt).toLocaleString() : '—'}
                </div>
              )}
              {detail.status === 'approved' && detail.changeType === 'create' && (
                <div style={{ color: 'var(--success, #16a34a)', fontWeight: 500 }}>
                  Now active as {detail.resultingWorkflowLabel ?? 'the new workflow'}
                </div>
              )}
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                  What's updated in this workflow?
                </div>
                <div style={{ color: 'var(--ink-2)' }}>{detail.reason}</div>
              </div>
              {detail.previousLimitations && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                    What the previous workflow lacks
                  </div>
                  <div style={{ color: 'var(--ink-2)' }}>{detail.previousLimitations}</div>
                </div>
              )}
              <div>
                <button
                  type="button"
                  className="btn sm ghost"
                  style={{ fontSize: 11 }}
                  onClick={() => setJsonExpanded((v) => !v)}
                >
                  {jsonExpanded ? 'Hide' : 'Show'} raw proposed fields
                </button>
                {jsonExpanded && (
                  <pre
                    style={{
                      margin: '8px 0 0',
                      fontSize: 11,
                      background: 'var(--subtle)',
                      padding: '10px 12px',
                      borderRadius: 6,
                      border: '1px solid var(--border)',
                      maxHeight: 240,
                      overflow: 'auto',
                      whiteSpace: 'pre',
                    }}
                  >
                    {JSON.stringify(detail.proposedFields, null, 2)}
                  </pre>
                )}
              </div>

              {detail.status === 'pending' && isSuperAdmin && (
                <div className="field" style={{ margin: 0 }}>
                  <label>Review note</label>
                  <textarea
                    className="input"
                    rows={3}
                    value={reviewNote}
                    disabled={approving || rejecting}
                    placeholder="Optional note for approval, required for rejection…"
                    onChange={(e) => setReviewNote(e.target.value)}
                  />
                </div>
              )}
              {detail.status !== 'pending' && detail.reviewNote && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Review note</div>
                  <div style={{ color: 'var(--ink-2)' }}>{detail.reviewNote}</div>
                </div>
              )}
              {detail.status === 'pending' && !isSuperAdmin && (
                <div style={{ color: 'var(--muted)', fontSize: 12 }}>
                  Awaiting SUPER_ADMIN review. You'll see the outcome here once it's approved or
                  rejected.
                </div>
              )}
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={closeDetail}>
                Close
              </button>
              {detail.status === 'pending' && isSuperAdmin && (
                <>
                  <button
                    className="btn danger"
                    disabled={approving || rejecting}
                    onClick={() => void handleReject()}
                  >
                    {rejecting ? 'Rejecting…' : 'Reject'}
                  </button>
                  <button
                    className="btn primary"
                    disabled={approving || rejecting}
                    onClick={() => void handleApprove()}
                  >
                    {approving ? 'Applying…' : 'Approve & apply'}
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
