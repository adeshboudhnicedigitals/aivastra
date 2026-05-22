import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/data';
import { Icon } from '../components/Icons';
import { StatusBadge } from '../components/StatusBadge';
import { NameAvatar } from '../components/NameAvatar';

type ReqStatus = 'pending' | 'approved' | 'rejected';

interface CreditRequest {
  id: string;
  userId: string;
  userEmail: string | null;
  creditsRequested: number;
  creditsApproved: number | null;
  note: string | null;
  status: string;
  createdAt: string;
}

interface Props {
  onNav: (_page: string) => void;
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
}

export default function CreditRequestsPage({ onNav: _onNav, toast }: Props) {
  const [tab, setTab] = useState<ReqStatus>('pending');
  const [requests, setRequests] = useState<CreditRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const [approving, setApproving] = useState<CreditRequest | null>(null);
  const [rejecting, setRejecting] = useState<CreditRequest | null>(null);
  const [approveAmount, setApproveAmount] = useState('');
  const [adminNote, setAdminNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ items: CreditRequest[] }>(`/admin/credits/requests?status=${tab}`);
      setRequests(data.items);
    } catch {
      toast({ kind: 'error', title: 'Failed to load credit requests' });
    } finally {
      setLoading(false);
    }
  }, [tab, toast]);

  useEffect(() => { load(); }, [load]);

  const openApprove = (r: CreditRequest) => {
    setApproving(r);
    setApproveAmount(String(r.creditsRequested));
    setAdminNote('');
  };

  const openReject = (r: CreditRequest) => {
    setRejecting(r);
    setAdminNote('');
  };

  const handleApprove = async () => {
    if (!approving) return;
    const amount = parseInt(approveAmount, 10);
    if (!amount || amount < 1) return;
    setBusy(true);
    try {
      await apiFetch(`/admin/credits/requests/${approving.id}/approve`, {
        method: 'PATCH',
        body: JSON.stringify({ creditsApproved: amount, adminNote: adminNote || undefined }),
      });
      toast({ title: `Approved ${amount.toLocaleString()} credits for ${approving.userEmail}` });
      setApproving(null);
      load();
    } catch {
      toast({ kind: 'error', title: 'Approve failed' });
    } finally {
      setBusy(false);
    }
  };

  const handleReject = async () => {
    if (!rejecting) return;
    setBusy(true);
    try {
      await apiFetch(`/admin/credits/requests/${rejecting.id}/reject`, {
        method: 'PATCH',
        body: JSON.stringify({ adminNote: adminNote || undefined }),
      });
      toast({ title: `Request from ${rejecting.userEmail} rejected` });
      setRejecting(null);
      load();
    } catch {
      toast({ kind: 'error', title: 'Reject failed' });
    } finally {
      setBusy(false);
    }
  };

  const pendingCount = tab === 'pending' ? requests.length : undefined;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Credit Requests</h1>
          <p className="lede">Users requesting additional credits &middot; Approve or reject below.</p>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20 }}>
        {(['pending', 'approved', 'rejected'] as ReqStatus[]).map((s) => (
          <button
            key={s}
            className={`btn${tab === s ? ' primary' : ' ghost'}`}
            onClick={() => setTab(s)}
            style={{ textTransform: 'capitalize' }}
          >
            {s}
            {s === 'pending' && pendingCount !== undefined && pendingCount > 0 && (
              <span className="count" style={{ marginLeft: 6 }}>{pendingCount}</span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <p style={{ color: 'var(--muted)', fontSize: 13, padding: '20px 0' }}>Loading&hellip;</p>
      ) : requests.length === 0 ? (
        <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
          No {tab} requests.
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>User</th>
                <th>Requested</th>
                {tab !== 'pending' && <th>Approved</th>}
                <th>Note from user</th>
                <th>Date</th>
                <th>Status</th>
                {tab === 'pending' && <th></th>}
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <NameAvatar name={r.userEmail ?? r.userId} email={r.userEmail ?? ''} size={30} />
                      <span className="mono" style={{ fontSize: 12 }}>{r.userEmail ?? r.userId}</span>
                    </div>
                  </td>
                  <td><span className="mono">{r.creditsRequested.toLocaleString()}</span></td>
                  {tab !== 'pending' && (
                    <td>
                      <span className="mono">{r.creditsApproved != null ? r.creditsApproved.toLocaleString() : '—'}</span>
                    </td>
                  )}
                  <td style={{ maxWidth: 260, fontSize: 12, color: r.note ? 'inherit' : 'var(--muted)' }}>
                    {r.note ?? '—'}
                  </td>
                  <td><span className="mono" style={{ fontSize: 12 }}>{new Date(r.createdAt).toLocaleString()}</span></td>
                  <td><StatusBadge status={r.status === 'approved' ? 'active' : r.status === 'rejected' ? 'FAILED' : 'QUEUED'} /></td>
                  {tab === 'pending' && (
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn sm primary" onClick={() => openApprove(r)}>
                          <Icon.Check /> Approve
                        </button>
                        <button className="btn sm danger" onClick={() => openReject(r)}>
                          <Icon.Close /> Reject
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Approve modal */}
      {approving && (
        <div className="modal-overlay" onClick={busy ? undefined : () => setApproving(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 'min(440px, calc(100vw - 40px))' }}>
            <div className="modal-head">
              <h3>Approve credit request</h3>
              <button className="btn sm ghost" onClick={() => setApproving(null)} disabled={busy} style={{ marginLeft: 'auto' }}>
                <Icon.Close />
              </button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <p style={{ margin: 0, fontSize: 13 }}>
                <strong>{approving.userEmail}</strong> requested <strong>{approving.creditsRequested.toLocaleString()}</strong> credits.
                {approving.note && <><br /><span style={{ color: 'var(--muted)' }}>Note: {approving.note}</span></>}
              </p>
              <div className="field">
                <label>Credits to grant</label>
                <input
                  className="input"
                  type="number"
                  min={1}
                  value={approveAmount}
                  disabled={busy}
                  onChange={(e) => setApproveAmount(e.target.value)}
                  placeholder="Amount"
                />
              </div>
              <div className="field">
                <label>Admin note (optional)</label>
                <input
                  className="input"
                  value={adminNote}
                  disabled={busy}
                  onChange={(e) => setAdminNote(e.target.value)}
                  placeholder="Visible to the team, not the user"
                />
              </div>
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setApproving(null)} disabled={busy}>Cancel</button>
              <button className="btn primary" onClick={handleApprove} disabled={busy || !parseInt(approveAmount, 10)}>
                <Icon.Check /> Grant {parseInt(approveAmount, 10) ? parseInt(approveAmount, 10).toLocaleString() : ''} credits
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject modal */}
      {rejecting && (
        <div className="modal-overlay" onClick={busy ? undefined : () => setRejecting(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 'min(400px, calc(100vw - 40px))' }}>
            <div className="modal-head">
              <h3>Reject credit request</h3>
              <button className="btn sm ghost" onClick={() => setRejecting(null)} disabled={busy} style={{ marginLeft: 'auto' }}>
                <Icon.Close />
              </button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <p style={{ margin: 0, fontSize: 13 }}>
                Reject <strong>{rejecting.userEmail}</strong>&apos;s request for <strong>{rejecting.creditsRequested.toLocaleString()}</strong> credits?
              </p>
              <div className="field">
                <label>Admin note (optional)</label>
                <input
                  className="input"
                  value={adminNote}
                  disabled={busy}
                  onChange={(e) => setAdminNote(e.target.value)}
                  placeholder="Internal reason"
                />
              </div>
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setRejecting(null)} disabled={busy}>Cancel</button>
              <button className="btn danger" onClick={handleReject} disabled={busy}>
                <Icon.Close /> Reject request
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
