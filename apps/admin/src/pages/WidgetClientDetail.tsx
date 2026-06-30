import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ApiError, apiFetch } from '../lib/data';

interface ClientDetail {
  id: string;
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  websiteUrl: string;
  companySize: string;
  purpose: string;
  businessAddress: string;
  widgetKey: string;
  isActive: boolean;
  allowedOrigins: string[];
  webhookUrl: string | null;
  webhookSecret: string | null;
  creditBalance: number;
  createdAt: string;
  updatedAt: string;
  ledger: { id: string; delta: number; reason: string; createdAt: string }[];
  recentJobs: {
    id: string;
    status: string;
    creditsCharged: number;
    createdAt: string;
    completedAt: string | null;
  }[];
}

interface Props {
  onNav: (_page: string, _filter?: { page: string; filter?: string }) => void;
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
}

export function WidgetClientDetail({ onNav: _onNav, toast }: Props) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [client, setClient] = useState<ClientDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const [editing, setEditing] = useState(false);
  const [editCompanyName, setEditCompanyName] = useState('');
  const [editAllowedOrigins, setEditAllowedOrigins] = useState('');
  const [editWebhookUrl, setEditWebhookUrl] = useState('');
  const [editWebhookSecret, setEditWebhookSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [saving, setSaving] = useState(false);

  const [creditAmount, setCreditAmount] = useState('');
  const [creditReason, setCreditReason] = useState('');
  const [addingCredits, setAddingCredits] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<ClientDetail>(`/v1/admin/widget-clients/${id}`);
      setClient(data);
      setEditCompanyName(data.companyName);
      setEditAllowedOrigins(data.allowedOrigins.join(', '));
      setEditWebhookUrl(data.webhookUrl || '');
      setEditWebhookSecret(data.webhookSecret || '');
    } catch {
      toast({ kind: 'error', title: 'Failed to load client' });
    } finally {
      setLoading(false);
    }
  }, [id, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleActive = async () => {
    if (!client) return;
    try {
      const updated = await apiFetch<{ isActive: boolean }>(`/v1/admin/widget-clients/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !client.isActive }),
      });
      setClient((prev) => (prev ? { ...prev, isActive: updated.isActive } : prev));
      toast({ title: `Client ${updated.isActive ? 'activated' : 'deactivated'}` });
    } catch {
      toast({ kind: 'error', title: 'Failed to update status' });
    }
  };

  const saveInfo = async () => {
    setSaving(true);
    try {
      const origins = editAllowedOrigins
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const updated = await apiFetch<ClientDetail>(`/v1/admin/widget-clients/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          companyName: editCompanyName,
          allowedOrigins: origins,
          webhookUrl: editWebhookUrl.trim() || null,
          webhookSecret: editWebhookSecret.trim() || null,
        }),
      });
      setClient(updated);
      setEditing(false);
      toast({ title: 'Info updated' });
    } catch (err) {
      let msg = 'Failed to update';
      if (err instanceof ApiError) {
        const body = err.body as { error?: { message?: string } } | undefined;
        msg = body?.error?.message ?? msg;
      } else if (err instanceof Error) {
        msg = err.message;
      }
      toast({ kind: 'error', title: msg });
    } finally {
      setSaving(false);
    }
  };

  const addCredits = async () => {
    const amount = parseInt(creditAmount, 10);
    if (!amount || amount <= 0 || !creditReason.trim()) return;
    setAddingCredits(true);
    try {
      const result = await apiFetch<{ newBalance: number }>(
        `/v1/admin/widget-clients/${id}/credits`,
        { method: 'POST', body: JSON.stringify({ amount, reason: creditReason }) },
      );
      setClient((prev) => (prev ? { ...prev, creditBalance: result.newBalance } : prev));
      setCreditAmount('');
      setCreditReason('');
      toast({ title: `${amount} credits added · new balance: ${result.newBalance}` });
    } catch {
      toast({ kind: 'error', title: 'Failed to add credits' });
    } finally {
      setAddingCredits(false);
    }
  };

  const formatDate = (d: string) => new Date(d).toLocaleDateString();

  if (loading) return <p style={{ color: 'var(--muted)', padding: '24px 0' }}>Loading…</p>;
  if (!client) return <p style={{ color: 'var(--muted)' }}>Client not found.</p>;

  const jobStatusClass = (s: string) =>
    s === 'COMPLETED' ? 'success' : s === 'FAILED' ? 'danger' : s === 'QUEUED' ? 'info' : 'warn';

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{client.companyName}</h1>
          <p className="lede">{client.email}</p>
        </div>
        <div className="head-tools">
          <button className="btn ghost" onClick={() => navigate('/widget-clients')}>
            ← Back
          </button>
        </div>
      </div>

      {/* Info card */}
      <div className="card">
        <div className="card-head">
          <h3>Client Info</h3>
          <div className="tools">
            {!editing ? (
              <button className="btn sm" onClick={() => setEditing(true)}>
                Edit
              </button>
            ) : (
              <>
                <button className="btn sm ghost" onClick={() => setEditing(false)}>
                  Cancel
                </button>
                <button className="btn sm primary" disabled={saving} onClick={saveInfo}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </>
            )}
          </div>
        </div>
        <div className="card-body">
          {editing ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="field">
                <label>Company Name</label>
                <input
                  className="input"
                  value={editCompanyName}
                  onChange={(e) => setEditCompanyName(e.target.value)}
                />
              </div>
              <div className="field">
                <label>
                  Allowed Origins <span className="sub">(comma-separated)</span>
                </label>
                <input
                  className="input"
                  value={editAllowedOrigins}
                  onChange={(e) => setEditAllowedOrigins(e.target.value)}
                  placeholder="https://yourstore.com, https://app.yourstore.com"
                />
              </div>
              <div className="field">
                <label>
                  Webhook URL <span className="sub">(HTTPS required)</span>
                </label>
                <input
                  className="input"
                  value={editWebhookUrl}
                  onChange={(e) => setEditWebhookUrl(e.target.value)}
                  placeholder="https://merchant.com/webhook"
                />
              </div>
              <div className="field">
                <label>Webhook Secret</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    className="input"
                    type={showSecret ? 'text' : 'password'}
                    style={{ flex: 1, fontFamily: 'monospace' }}
                    value={editWebhookSecret}
                    onChange={(e) => setEditWebhookSecret(e.target.value)}
                    placeholder="Shared secret for HMAC signature"
                  />
                  <button className="btn ghost" onClick={() => setShowSecret(!showSecret)}>
                    {showSecret ? 'Hide' : 'Show'}
                  </button>
                  <button
                    className="btn"
                    onClick={() => {
                      const bytes = new Uint8Array(32);
                      window.crypto.getRandomValues(bytes);
                      const hex = Array.from(bytes)
                        .map((b) => b.toString(16).padStart(2, '0'))
                        .join('');
                      setEditWebhookSecret(hex);
                      setShowSecret(true);
                    }}
                  >
                    Generate
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <dl className="kv">
              <dt>Contact</dt>
              <dd>{client.contactName}</dd>
              <dt>Email</dt>
              <dd className="mono">{client.email}</dd>
              <dt>Phone</dt>
              <dd>{client.phone}</dd>
              <dt>Website</dt>
              <dd>
                <a href={client.websiteUrl} target="_blank" rel="noreferrer">
                  {client.websiteUrl}
                </a>
              </dd>
              <dt>Company Size</dt>
              <dd>{client.companySize}</dd>
              <dt>Purpose</dt>
              <dd>{client.purpose}</dd>
              <dt>Address</dt>
              <dd>{client.businessAddress}</dd>
              <dt>Widget Key</dt>
              <dd className="mono" style={{ fontSize: 12, wordBreak: 'break-all' }}>
                {client.widgetKey}
              </dd>
              <dt>Allowed Origins</dt>
              <dd>
                {client.allowedOrigins.length ? (
                  client.allowedOrigins.join(', ')
                ) : (
                  <span style={{ color: 'var(--muted)' }}>None</span>
                )}
              </dd>
              <dt>Webhook URL</dt>
              <dd>
                {client.webhookUrl ? (
                  <a href={client.webhookUrl} target="_blank" rel="noreferrer">
                    {client.webhookUrl}
                  </a>
                ) : (
                  <span style={{ color: 'var(--muted)' }}>None</span>
                )}
              </dd>
              <dt>Webhook Secret</dt>
              <dd>
                {client.webhookSecret ? (
                  <span style={{ color: 'var(--muted)' }}>••••••••••••••••••••••••</span>
                ) : (
                  <span style={{ color: 'var(--muted)' }}>None</span>
                )}
              </dd>
              <dt>Created</dt>
              <dd>{formatDate(client.createdAt)}</dd>
              <dt>Updated</dt>
              <dd>{formatDate(client.updatedAt)}</dd>
            </dl>
          )}
        </div>
      </div>

      {/* Status card */}
      <div className="card">
        <div className="card-head">
          <h3>Account Status</h3>
        </div>
        <div className="card-body">
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span className={`badge dot ${client.isActive ? 'success' : 'danger'}`}>
              {client.isActive ? 'Active' : 'Inactive'}
            </span>
            <button className={`btn sm ${client.isActive ? 'danger' : ''}`} onClick={toggleActive}>
              {client.isActive ? 'Deactivate' : 'Activate'}
            </button>
          </div>
        </div>
      </div>

      {/* Credits card */}
      <div className="card">
        <div className="card-head">
          <h3>Credits</h3>
          <div className="tools">
            <span
              style={{
                fontFamily: 'var(--mono)',
                fontSize: 22,
                fontWeight: 600,
                color: 'var(--ink)',
                letterSpacing: '-0.02em',
              }}
            >
              {client.creditBalance ?? 0}
            </span>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>balance</span>
          </div>
        </div>
        <div className="card-body">
          <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 14px' }}>
            Add credits to this merchant's account.
          </p>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Amount</label>
              <input
                className="input"
                type="number"
                min={1}
                value={creditAmount}
                onChange={(e) => setCreditAmount(e.target.value)}
                style={{ width: 110 }}
                placeholder="100"
              />
            </div>
            <div className="field" style={{ marginBottom: 0, flex: 1, minWidth: 180 }}>
              <label>Reason</label>
              <input
                className="input"
                value={creditReason}
                onChange={(e) => setCreditReason(e.target.value)}
                placeholder="e.g. Trial grant"
                style={{ width: '100%' }}
              />
            </div>
            <button
              className="btn primary"
              disabled={addingCredits || !creditAmount || !creditReason.trim()}
              onClick={addCredits}
            >
              {addingCredits ? 'Adding…' : 'Add Credits'}
            </button>
          </div>
        </div>
      </div>

      {/* Credit ledger */}
      {client.ledger.length > 0 && (
        <div className="card">
          <div className="card-head">
            <h3>Credit Ledger</h3>
            <span className="sub tools">{client.ledger.length} entries</span>
          </div>
          <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
            <table>
              <thead>
                <tr>
                  <th style={{ textAlign: 'center' }}>Date</th>
                  <th style={{ textAlign: 'center' }}>Delta</th>
                  <th style={{ textAlign: 'center' }}>Reason</th>
                </tr>
              </thead>
              <tbody>
                {client.ledger.map((l) => (
                  <tr key={l.id} style={{ textAlign: 'center' }}>
                    <td style={{ color: 'var(--muted)', fontSize: 13 }}>
                      {formatDate(l.createdAt)}
                    </td>
                    <td>
                      <span className={`badge mono ${l.delta > 0 ? 'success' : 'danger'}`}>
                        {l.delta > 0 ? `+${l.delta}` : l.delta}
                      </span>
                    </td>
                    <td>{l.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Recent jobs */}
      <div className="card">
        <div className="card-head">
          <h3>Recent Jobs</h3>
          <span className="sub tools">{client.recentJobs.length} jobs</span>
        </div>
        {client.recentJobs.length === 0 ? (
          <div className="empty">No jobs yet.</div>
        ) : (
          <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
            <table>
              <thead>
                <tr>
                  <th style={{ textAlign: 'center' }}>Date</th>
                  <th style={{ textAlign: 'center' }}>Status</th>
                  <th style={{ textAlign: 'center' }}>Credits</th>
                  <th style={{ textAlign: 'center' }}>Completed</th>
                </tr>
              </thead>
              <tbody>
                {client.recentJobs.map((j) => (
                  <tr key={j.id} style={{ textAlign: 'center' }}>
                    <td style={{ color: 'var(--muted)', fontSize: 13 }}>
                      {formatDate(j.createdAt)}
                    </td>
                    <td>
                      <span className={`badge dot ${jobStatusClass(j.status)}`}>{j.status}</span>
                    </td>
                    <td className="num">{j.creditsCharged}</td>
                    <td style={{ color: 'var(--muted)', fontSize: 13 }}>
                      {j.completedAt ? formatDate(j.completedAt) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
