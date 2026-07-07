import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiErrorMessage, apiFetch } from '../lib/data';

type DetailTab = 'overview' | 'catalog';

type LinkedUser = {
  id: string;
  email: string;
  displayName: string | null;
  emailVerified: boolean;
};

type KioskDevice = {
  id: string;
  label: string;
  status: string;
  androidId: string | null;
  appVersion: string | null;
  pairingCodeExpiresAt: string | null;
  pairedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type MerchantCatalogItem = {
  id: string;
  label: string;
  sku: string | null;
  gender: string | null;
  category: string | null;
  thumbnailUrl: string | null;
  sourceKind: 'imported' | 'uploaded';
  isActive: boolean;
  moderationStatus: 'approved' | 'rejected';
  moderationNote: string | null;
  updatedAt: string;
};

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
  kioskEnabled: boolean;
  maxKioskDevices: number;
  userId: string | null;
  allowedOrigins: string[];
  webhookUrl: string | null;
  webhookSecret: string | null;
  creditBalance: number;
  createdAt: string;
  updatedAt: string;
  linkedUser: LinkedUser | null;
  suggestedUser: LinkedUser | null;
  kioskDevices: KioskDevice[];
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
  const [tab, setTab] = useState<DetailTab>('overview');

  const [editing, setEditing] = useState(false);
  const [editCompanyName, setEditCompanyName] = useState('');
  const [editAllowedOrigins, setEditAllowedOrigins] = useState('');
  const [editWebhookUrl, setEditWebhookUrl] = useState('');
  const [editWebhookSecret, setEditWebhookSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [savingInfo, setSavingInfo] = useState(false);

  const [kioskEnabled, setKioskEnabled] = useState(false);
  const [maxKioskDevices, setMaxKioskDevices] = useState('5');
  const [savingKiosk, setSavingKiosk] = useState(false);

  const [creditAmount, setCreditAmount] = useState('');
  const [creditReason, setCreditReason] = useState('');
  const [addingCredits, setAddingCredits] = useState(false);

  const [linking, setLinking] = useState(false);
  const [deviceLabel, setDeviceLabel] = useState('');
  const [deviceBusyId, setDeviceBusyId] = useState<string | null>(null);
  const [creatingDevice, setCreatingDevice] = useState(false);
  const [pairingCode, setPairingCode] = useState<string | null>(null);

  const [catalogItems, setCatalogItems] = useState<MerchantCatalogItem[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  const [catalogSavingId, setCatalogSavingId] = useState<string | null>(null);
  const [catalogDrafts, setCatalogDrafts] = useState<
    Record<
      string,
      {
        isActive: boolean;
        moderationStatus: 'approved' | 'rejected';
        moderationNote: string;
      }
    >
  >({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<ClientDetail>(`/v1/admin/widget-clients/${id}`);
      setClient(data);
      setEditCompanyName(data.companyName);
      setEditAllowedOrigins(data.allowedOrigins.join(', '));
      setEditWebhookUrl(data.webhookUrl || '');
      setEditWebhookSecret(data.webhookSecret || '');
      setKioskEnabled(data.kioskEnabled);
      setMaxKioskDevices(String(data.maxKioskDevices));
    } catch (err) {
      toast({ kind: 'error', title: apiErrorMessage(err, 'Failed to load client') });
    } finally {
      setLoading(false);
    }
  }, [id, toast]);

  const loadCatalog = useCallback(async () => {
    if (!id) return;
    setCatalogLoading(true);
    try {
      const data = await apiFetch<{ items: MerchantCatalogItem[] }>(
        `/admin/merchant-catalog?widgetClientId=${id}`,
      );
      setCatalogItems(data.items ?? []);
      setCatalogDrafts(
        Object.fromEntries(
          (data.items ?? []).map((item) => [
            item.id,
            {
              isActive: item.isActive,
              moderationStatus: item.moderationStatus,
              moderationNote: item.moderationNote ?? '',
            },
          ]),
        ),
      );
      setCatalogLoaded(true);
    } catch (err) {
      toast({ kind: 'error', title: apiErrorMessage(err, 'Failed to load private catalog') });
    } finally {
      setCatalogLoading(false);
    }
  }, [id, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (tab === 'catalog' && !catalogLoaded) {
      void loadCatalog();
    }
  }, [catalogLoaded, loadCatalog, tab]);

  const toggleActive = async () => {
    if (!client) return;
    try {
      const updated = await apiFetch<{ isActive: boolean }>(`/v1/admin/widget-clients/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !client.isActive }),
      });
      setClient((prev) => (prev ? { ...prev, isActive: updated.isActive } : prev));
      toast({ title: `Client ${updated.isActive ? 'activated' : 'deactivated'}` });
    } catch (err) {
      toast({ kind: 'error', title: apiErrorMessage(err, 'Failed to update status') });
    }
  };

  const saveInfo = async () => {
    setSavingInfo(true);
    try {
      const origins = editAllowedOrigins
        .split(',')
        .map((value) => value.trim())
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
      setClient((prev) =>
        prev
          ? {
              ...prev,
              companyName: updated.companyName,
              allowedOrigins: updated.allowedOrigins,
              webhookUrl: updated.webhookUrl,
              webhookSecret: updated.webhookSecret,
              updatedAt: updated.updatedAt,
            }
          : prev,
      );
      setEditing(false);
      toast({ title: 'Info updated' });
    } catch (err) {
      toast({ kind: 'error', title: apiErrorMessage(err, 'Failed to update client info') });
    } finally {
      setSavingInfo(false);
    }
  };

  const saveKioskSettings = async () => {
    const limit = parseInt(maxKioskDevices, 10);
    if (!limit || limit < 1) {
      toast({ kind: 'error', title: 'Max kiosk devices must be at least 1' });
      return;
    }
    setSavingKiosk(true);
    try {
      const updated = await apiFetch<{ kioskEnabled: boolean; maxKioskDevices: number }>(
        `/v1/admin/widget-clients/${id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ kioskEnabled, maxKioskDevices: limit }),
        },
      );
      setClient((prev) =>
        prev
          ? {
              ...prev,
              kioskEnabled: updated.kioskEnabled,
              maxKioskDevices: updated.maxKioskDevices,
            }
          : prev,
      );
      setKioskEnabled(updated.kioskEnabled);
      setMaxKioskDevices(String(updated.maxKioskDevices));
      toast({ title: 'Kiosk settings updated' });
    } catch (err) {
      toast({ kind: 'error', title: apiErrorMessage(err, 'Failed to update kiosk settings') });
    } finally {
      setSavingKiosk(false);
    }
  };

  const addCredits = async () => {
    const amount = parseInt(creditAmount, 10);
    if (!amount || amount <= 0 || !creditReason.trim()) return;
    setAddingCredits(true);
    try {
      const result = await apiFetch<{ newBalance: number }>(
        `/v1/admin/widget-clients/${id}/credits`,
        {
          method: 'POST',
          body: JSON.stringify({ amount, reason: creditReason }),
        },
      );
      setClient((prev) => (prev ? { ...prev, creditBalance: result.newBalance } : prev));
      setCreditAmount('');
      setCreditReason('');
      toast({ title: `${amount} credits added. New balance: ${result.newBalance}` });
    } catch (err) {
      toast({ kind: 'error', title: apiErrorMessage(err, 'Failed to add credits') });
    } finally {
      setAddingCredits(false);
    }
  };

  const setLinkedUser = async (userId: string | null) => {
    setLinking(true);
    try {
      await apiFetch(`/v1/admin/widget-clients/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ userId }),
      });
      await load();
      toast({ title: userId ? 'Linked user updated' : 'Linked user removed' });
    } catch (err) {
      toast({ kind: 'error', title: apiErrorMessage(err, 'Failed to update linked user') });
    } finally {
      setLinking(false);
    }
  };

  const createDevice = async () => {
    if (!deviceLabel.trim()) return;
    setCreatingDevice(true);
    try {
      const result = await apiFetch<{ device: KioskDevice; pairingCode: string }>(
        `/v1/admin/widget-clients/${id}/kiosk-devices`,
        {
          method: 'POST',
          body: JSON.stringify({ label: deviceLabel.trim() }),
        },
      );
      setClient((prev) =>
        prev ? { ...prev, kioskDevices: [result.device, ...prev.kioskDevices] } : prev,
      );
      setDeviceLabel('');
      setPairingCode(result.pairingCode);
      toast({ title: 'Kiosk device created' });
    } catch (err) {
      toast({ kind: 'error', title: apiErrorMessage(err, 'Failed to create kiosk device') });
    } finally {
      setCreatingDevice(false);
    }
  };

  const regeneratePairingCode = async (deviceId: string) => {
    setDeviceBusyId(deviceId);
    try {
      const result = await apiFetch<{ device: KioskDevice; pairingCode: string }>(
        `/v1/admin/widget-clients/${id}/kiosk-devices/${deviceId}/pairing-code`,
        { method: 'POST' },
      );
      setClient((prev) =>
        prev
          ? {
              ...prev,
              kioskDevices: prev.kioskDevices.map((device) =>
                device.id === deviceId ? result.device : device,
              ),
            }
          : prev,
      );
      setPairingCode(result.pairingCode);
      toast({ title: 'Pairing code generated' });
    } catch (err) {
      toast({ kind: 'error', title: apiErrorMessage(err, 'Failed to generate pairing code') });
    } finally {
      setDeviceBusyId(null);
    }
  };

  const revokeDevice = async (deviceId: string) => {
    setDeviceBusyId(deviceId);
    try {
      const result = await apiFetch<KioskDevice>(
        `/v1/admin/widget-clients/${id}/kiosk-devices/${deviceId}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ status: 'revoked' }),
        },
      );
      setClient((prev) =>
        prev
          ? {
              ...prev,
              kioskDevices: prev.kioskDevices.map((device) =>
                device.id === deviceId ? result : device,
              ),
            }
          : prev,
      );
      toast({ title: 'Kiosk device revoked' });
    } catch (err) {
      toast({ kind: 'error', title: apiErrorMessage(err, 'Failed to revoke kiosk device') });
    } finally {
      setDeviceBusyId(null);
    }
  };

  const updateCatalogDraft = (
    itemId: string,
    patch: Partial<{
      isActive: boolean;
      moderationStatus: 'approved' | 'rejected';
      moderationNote: string;
    }>,
  ) => {
    setCatalogDrafts((prev) => ({
      ...prev,
      [itemId]: { ...prev[itemId], ...patch },
    }));
  };

  const saveCatalogItem = async (itemId: string) => {
    const draft = catalogDrafts[itemId];
    if (!draft) return;
    setCatalogSavingId(itemId);
    try {
      const updated = await apiFetch<MerchantCatalogItem>(`/admin/merchant-catalog/${itemId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          isActive: draft.isActive,
          moderationStatus: draft.moderationStatus,
          moderationNote: draft.moderationNote.trim() || null,
        }),
      });
      setCatalogItems((prev) => prev.map((item) => (item.id === itemId ? updated : item)));
      setCatalogDrafts((prev) => ({
        ...prev,
        [itemId]: {
          isActive: updated.isActive,
          moderationStatus: updated.moderationStatus,
          moderationNote: updated.moderationNote ?? '',
        },
      }));
      toast({ title: 'Private catalog item updated' });
    } catch (err) {
      toast({
        kind: 'error',
        title: apiErrorMessage(err, 'Failed to update private catalog item'),
      });
    } finally {
      setCatalogSavingId(null);
    }
  };

  const formatDate = (value: string | null) => (value ? new Date(value).toLocaleString() : '-');

  if (loading) return <p style={{ color: 'var(--muted)', padding: '24px 0' }}>Loading...</p>;
  if (!client) return <p style={{ color: 'var(--muted)' }}>Client not found.</p>;

  const jobStatusClass = (status: string) =>
    status === 'COMPLETED'
      ? 'success'
      : status === 'FAILED'
        ? 'danger'
        : status === 'QUEUED'
          ? 'info'
          : 'warn';

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{client.companyName}</h1>
          <p className="lede">{client.email}</p>
        </div>
        <div className="head-tools" style={{ display: 'flex', gap: 10 }}>
          <button className="btn ghost" onClick={() => navigate('/widget-clients')}>
            Back
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
        <button
          className={`btn ${tab === 'overview' ? 'primary' : 'ghost'}`}
          onClick={() => setTab('overview')}
        >
          Overview
        </button>
        <button
          className={`btn ${tab === 'catalog' ? 'primary' : 'ghost'}`}
          onClick={() => setTab('catalog')}
        >
          Private Catalog
        </button>
      </div>

      {tab === 'overview' ? (
        <>
          {pairingCode ? (
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="card-head">
                <h3>Pairing Code</h3>
              </div>
              <div className="card-body">
                <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 0 }}>
                  This code is shown exactly once. Enter it on the kiosk device during claim.
                </p>
                <code style={{ fontSize: 28, fontWeight: 700, letterSpacing: '0.12em' }}>
                  {pairingCode}
                </code>
              </div>
            </div>
          ) : null}

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
                    <button className="btn sm primary" disabled={savingInfo} onClick={saveInfo}>
                      {savingInfo ? 'Saving...' : 'Save'}
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
                      />
                      <button
                        className="btn ghost"
                        onClick={() => setShowSecret((value) => !value)}
                      >
                        {showSecret ? 'Hide' : 'Show'}
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
                      <span style={{ color: 'var(--muted)' }}>Configured</span>
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

          <div className="card">
            <div className="card-head">
              <h3>Account Status</h3>
            </div>
            <div className="card-body">
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <span className={`badge dot ${client.isActive ? 'success' : 'danger'}`}>
                  {client.isActive ? 'Active' : 'Inactive'}
                </span>
                <button
                  className={`btn sm ${client.isActive ? 'danger' : ''}`}
                  onClick={toggleActive}
                >
                  {client.isActive ? 'Deactivate' : 'Activate'}
                </button>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h3>Kiosk Access</h3>
              <div className="tools">
                <button
                  className="btn sm primary"
                  disabled={savingKiosk}
                  onClick={saveKioskSettings}
                >
                  {savingKiosk ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
            <div
              className="card-body"
              style={{
                display: 'grid',
                gridTemplateColumns: '220px 220px',
                gap: 16,
                alignItems: 'end',
              }}
            >
              <label className="field" style={{ marginBottom: 0 }}>
                <span>Kiosk enabled</span>
                <input
                  type="checkbox"
                  checked={kioskEnabled}
                  onChange={(e) => setKioskEnabled(e.target.checked)}
                />
              </label>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Max kiosk devices</label>
                <input
                  className="input"
                  type="number"
                  min={1}
                  value={maxKioskDevices}
                  onChange={(e) => setMaxKioskDevices(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h3>Linked User</h3>
            </div>
            <div
              className="card-body"
              style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
            >
              {client.linkedUser ? (
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 16,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, color: 'var(--ink)' }}>
                      {client.linkedUser.displayName || client.linkedUser.email}
                    </div>
                    <div style={{ color: 'var(--muted)', fontSize: 13 }}>
                      {client.linkedUser.email}{' '}
                      {client.linkedUser.emailVerified ? '(verified)' : '(unverified)'}
                    </div>
                  </div>
                  <button
                    className="btn sm ghost"
                    disabled={linking}
                    onClick={() => void setLinkedUser(null)}
                  >
                    Remove Link
                  </button>
                </div>
              ) : (
                <p style={{ color: 'var(--muted)', margin: 0 }}>No studio user linked.</p>
              )}

              {!client.linkedUser && client.suggestedUser ? (
                <div
                  style={{
                    padding: 14,
                    border: '1px solid var(--line)',
                    borderRadius: 12,
                    background: 'var(--panel-2)',
                  }}
                >
                  <div style={{ fontWeight: 600, color: 'var(--ink)', marginBottom: 6 }}>
                    Suggested verified match
                  </div>
                  <div style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 10 }}>
                    {client.suggestedUser.displayName || client.suggestedUser.email} (
                    {client.suggestedUser.email})
                  </div>
                  <button
                    className="btn sm primary"
                    disabled={linking}
                    // biome-ignore lint/style/noNonNullAssertion: guarded by the enclosing suggestedUser ternary
                    onClick={() => void setLinkedUser(client.suggestedUser!.id)}
                  >
                    Confirm link
                  </button>
                </div>
              ) : null}
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h3>Kiosk Devices</h3>
              <div className="tools" style={{ display: 'flex', gap: 10 }}>
                <input
                  className="input"
                  style={{ width: 220 }}
                  placeholder="Front counter tablet"
                  value={deviceLabel}
                  onChange={(e) => setDeviceLabel(e.target.value)}
                />
                <button
                  className="btn sm primary"
                  disabled={creatingDevice || !deviceLabel.trim()}
                  onClick={createDevice}
                >
                  {creatingDevice ? 'Creating...' : 'Create'}
                </button>
              </div>
            </div>
            {client.kioskDevices.length === 0 ? (
              <div className="empty">No kiosk devices created yet.</div>
            ) : (
              <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Label</th>
                      <th>Status</th>
                      <th>Paired</th>
                      <th>Expires</th>
                      <th style={{ textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {client.kioskDevices.map((device) => (
                      <tr key={device.id}>
                        <td>{device.label}</td>
                        <td>
                          <span
                            className={`badge dot ${
                              device.status === 'active'
                                ? 'success'
                                : device.status === 'revoked'
                                  ? 'danger'
                                  : 'info'
                            }`}
                          >
                            {device.status}
                          </span>
                        </td>
                        <td style={{ color: 'var(--muted)', fontSize: 13 }}>
                          {formatDate(device.pairedAt)}
                        </td>
                        <td style={{ color: 'var(--muted)', fontSize: 13 }}>
                          {formatDate(device.pairingCodeExpiresAt)}
                        </td>
                        <td>
                          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                            <button
                              className="btn sm"
                              disabled={deviceBusyId === device.id || device.status === 'active'}
                              onClick={() => void regeneratePairingCode(device.id)}
                            >
                              {deviceBusyId === device.id ? 'Working...' : 'Pairing Code'}
                            </button>
                            <button
                              className="btn sm ghost"
                              disabled={deviceBusyId === device.id || device.status === 'revoked'}
                              onClick={() => void revokeDevice(device.id)}
                            >
                              Revoke
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

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
                  }}
                >
                  {client.creditBalance ?? 0}
                </span>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>balance</span>
              </div>
            </div>
            <div className="card-body">
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
                  />
                </div>
                <div className="field" style={{ marginBottom: 0, flex: 1, minWidth: 180 }}>
                  <label>Reason</label>
                  <input
                    className="input"
                    value={creditReason}
                    onChange={(e) => setCreditReason(e.target.value)}
                    style={{ width: '100%' }}
                  />
                </div>
                <button
                  className="btn primary"
                  disabled={addingCredits || !creditAmount || !creditReason.trim()}
                  onClick={addCredits}
                >
                  {addingCredits ? 'Adding...' : 'Add Credits'}
                </button>
              </div>
            </div>
          </div>

          {client.ledger.length > 0 ? (
            <div className="card">
              <div className="card-head">
                <h3>Credit Ledger</h3>
                <span className="sub tools">{client.ledger.length} entries</span>
              </div>
              <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Delta</th>
                      <th>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {client.ledger.map((entry) => (
                      <tr key={entry.id}>
                        <td style={{ color: 'var(--muted)', fontSize: 13 }}>
                          {formatDate(entry.createdAt)}
                        </td>
                        <td>
                          <span className={`badge mono ${entry.delta > 0 ? 'success' : 'danger'}`}>
                            {entry.delta > 0 ? `+${entry.delta}` : entry.delta}
                          </span>
                        </td>
                        <td>{entry.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

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
                      <th>Date</th>
                      <th>Status</th>
                      <th>Credits</th>
                      <th>Completed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {client.recentJobs.map((job) => (
                      <tr key={job.id}>
                        <td style={{ color: 'var(--muted)', fontSize: 13 }}>
                          {formatDate(job.createdAt)}
                        </td>
                        <td>
                          <span className={`badge dot ${jobStatusClass(job.status)}`}>
                            {job.status}
                          </span>
                        </td>
                        <td className="num">{job.creditsCharged}</td>
                        <td style={{ color: 'var(--muted)', fontSize: 13 }}>
                          {formatDate(job.completedAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="card">
          <div className="card-head">
            <h3>Private Catalog</h3>
            <div className="tools">
              <button
                className="btn sm ghost"
                onClick={() => void loadCatalog()}
                disabled={catalogLoading}
              >
                {catalogLoading ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>
          </div>
          {catalogLoading ? (
            <div className="empty">Loading private catalog...</div>
          ) : catalogItems.length === 0 ? (
            <div className="empty">No private catalog items for this merchant yet.</div>
          ) : (
            <div
              className="card-body"
              style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
            >
              {catalogItems.map((item) => {
                const draft = catalogDrafts[item.id];
                return (
                  <div
                    key={item.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '120px minmax(0, 1fr)',
                      gap: 16,
                      padding: 16,
                      border: '1px solid var(--line)',
                      borderRadius: 14,
                    }}
                  >
                    <div
                      style={{
                        aspectRatio: '3 / 4',
                        borderRadius: 10,
                        overflow: 'hidden',
                        background: 'var(--panel-2)',
                      }}
                    >
                      {item.thumbnailUrl ? (
                        // biome-ignore lint/performance/noImgElement: admin panel
                        <img
                          src={item.thumbnailUrl}
                          alt={item.label}
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      ) : null}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                        <div>
                          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>
                            {item.label}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                            {item.sourceKind === 'imported'
                              ? 'Imported from studio'
                              : 'Direct upload'}
                            {item.category ? ` | ${item.category}` : ''}
                            {item.gender ? ` | ${item.gender}` : ''}
                          </div>
                        </div>
                        <span className={`badge ${item.isActive ? 'success' : 'danger'}`}>
                          {item.isActive ? 'Active' : 'Hidden'}
                        </span>
                      </div>

                      <label
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 8,
                          fontSize: 13,
                          color: 'var(--muted)',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={draft?.isActive ?? item.isActive}
                          onChange={(e) =>
                            updateCatalogDraft(item.id, { isActive: e.target.checked })
                          }
                        />
                        Visible on kiosk
                      </label>

                      <div className="field" style={{ marginBottom: 0 }}>
                        <label>Moderation Status</label>
                        <select
                          className="input"
                          value={draft?.moderationStatus ?? item.moderationStatus}
                          onChange={(e) =>
                            updateCatalogDraft(item.id, {
                              moderationStatus: e.target.value as 'approved' | 'rejected',
                            })
                          }
                        >
                          <option value="approved">approved</option>
                          <option value="rejected">rejected</option>
                        </select>
                      </div>

                      <div className="field" style={{ marginBottom: 0 }}>
                        <label>Moderation Note</label>
                        <textarea
                          className="input"
                          rows={3}
                          value={draft?.moderationNote ?? item.moderationNote ?? ''}
                          onChange={(e) =>
                            updateCatalogDraft(item.id, { moderationNote: e.target.value })
                          }
                        />
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                          Updated {formatDate(item.updatedAt)}
                        </span>
                        <button
                          className="btn sm primary"
                          disabled={catalogSavingId === item.id}
                          onClick={() => void saveCatalogItem(item.id)}
                        >
                          {catalogSavingId === item.id ? 'Saving...' : 'Save'}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </>
  );
}
