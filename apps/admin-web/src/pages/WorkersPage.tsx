import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../components/Icons';
import { Switch } from '../components/Switch';
import { apiFetch } from '../lib/data';

type JobType = 'catalogue' | 'tryon' | 'saree' | 'shopify';

interface Worker {
  id: string;
  label: string;
  url: string;
  apiKeyHint: string;
  isActive: boolean;
  allowedJobTypes: JobType[];
  status: 'IDLE' | 'BUSY' | 'DRAINING';
  healthy: boolean;
  lastSeen: number | null;
  createdAt: string;
  updatedAt: string;
}

interface Props {
  onNav: (_page: string, _filter?: { page: string; filter?: string }) => void;
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
}

const JOB_TYPES: JobType[] = ['catalogue', 'tryon', 'saree', 'shopify'];
const JOB_TYPE_LABELS: Record<JobType, string> = {
  catalogue: 'Catalogue',
  tryon: 'Tryon',
  saree: 'Saree',
  shopify: 'Shopify',
};

const EMPTY_FORM = { id: '', label: '', url: '', apiKey: '', allowedJobTypes: [] as JobType[] };

export default function WorkersPage({ toast }: Props) {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editTarget, setEditTarget] = useState<Worker | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Worker | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<Worker[]>('/admin/workers');
      setWorkers(data);
    } catch {
      toast({ kind: 'error', title: 'Failed to load workers' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
    intervalRef.current = setInterval(() => void load(), 15_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [load]);

  function openAdd() {
    setForm(EMPTY_FORM);
    setEditTarget(null);
    setShowAdd(true);
  }

  function openEdit(w: Worker) {
    setForm({
      id: w.id,
      label: w.label,
      url: w.url,
      apiKey: '',
      allowedJobTypes: w.allowedJobTypes ?? [],
    });
    setEditTarget(w);
    setShowAdd(true);
  }

  function closeModal() {
    setShowAdd(false);
    setEditTarget(null);
    setForm(EMPTY_FORM);
  }

  async function handleSave() {
    setSaving(true);
    try {
      if (editTarget) {
        const body: Record<string, string | boolean | string[]> = {};
        if (form.label !== editTarget.label) body.label = form.label;
        if (form.url !== editTarget.url) body.url = form.url;
        if (form.apiKey) body.apiKey = form.apiKey;
        const typesChanged =
          JSON.stringify([...form.allowedJobTypes].sort()) !==
          JSON.stringify([...(editTarget.allowedJobTypes ?? [])].sort());
        if (typesChanged) body.allowedJobTypes = form.allowedJobTypes;
        await apiFetch(`/admin/workers/${editTarget.id}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
        toast({ title: 'Worker updated' });
      } else {
        await apiFetch('/admin/workers', {
          method: 'POST',
          body: JSON.stringify(form),
        });
        toast({ title: 'Worker added' });
      }
      closeModal();
      void load();
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'body' in err
          ? ((err as { body?: { error?: { message?: string } } }).body?.error?.message ?? 'Failed')
          : 'Failed';
      toast({ kind: 'error', title: msg });
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(w: Worker) {
    try {
      await apiFetch(`/admin/workers/${w.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !w.isActive }),
      });
      toast({ title: `Worker ${w.id} ${w.isActive ? 'deactivated' : 'activated'}` });
      void load();
    } catch {
      toast({ kind: 'error', title: 'Failed to update worker' });
    }
  }

  async function handleDelete(w: Worker) {
    setConfirmDelete(w);
  }

  async function doDelete(id: string) {
    setConfirmDelete(null);
    setDeleting(id);
    try {
      await apiFetch(`/admin/workers/${id}`, { method: 'DELETE' });
      toast({ title: `Worker ${id} deleted` });
      void load();
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'body' in err
          ? ((err as { body?: { error?: { message?: string } } }).body?.error?.message ?? 'Failed')
          : 'Failed';
      toast({ kind: 'error', title: msg });
    } finally {
      setDeleting(null);
    }
  }

  function statusColor(w: Worker): string {
    if (!w.isActive || w.status === 'DRAINING') return 'var(--warn)';
    if (w.status === 'BUSY') return 'var(--accent)';
    return 'var(--muted)';
  }

  function formatLastSeen(ts: number | null): string {
    if (!ts) return '—';
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return `${Math.floor(diff / 3600)}h ago`;
  }

  const canSave = editTarget
    ? form.url.startsWith('http')
    : form.id.length > 0 && form.url.startsWith('http') && form.apiKey.length > 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Workers</h1>
          <p className="lede">ComfyUI GPU workers. Changes take effect within 15 s.</p>
        </div>
        <button className="btn btn--primary" onClick={openAdd}>
          <Icon.Add />
          Add Worker
        </button>
      </div>

      {loading ? (
        <p style={{ color: 'var(--muted)', padding: '24px 0' }}>Loading…</p>
      ) : workers.length === 0 ? (
        <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--muted)' }}>
          <Icon.Server />
          <p style={{ marginTop: 12 }}>No workers registered. Add one to start processing jobs.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>ID / Label</th>
                <th>URL</th>
                <th>Job Types</th>
                <th>Status</th>
                <th>Health</th>
                <th>Last Seen</th>
                <th>API Key</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {workers.map((w) => (
                <tr key={w.id} style={{ opacity: w.isActive ? 1 : 0.55 }}>
                  <td>
                    <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{w.id}</div>
                    {w.label && (
                      <div style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>{w.label}</div>
                    )}
                  </td>
                  <td>
                    <span
                      style={{
                        fontFamily: 'monospace',
                        fontSize: '0.78rem',
                        color: 'var(--muted)',
                      }}
                    >
                      {w.url}
                    </span>
                  </td>
                  <td>
                    {w.allowedJobTypes && w.allowedJobTypes.length > 0 ? (
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {w.allowedJobTypes.map((t) => (
                          <span
                            key={t}
                            style={{
                              display: 'inline-block',
                              padding: '2px 7px',
                              borderRadius: 4,
                              fontSize: '0.72rem',
                              fontWeight: 600,
                              background:
                                t === 'tryon'
                                  ? 'color-mix(in srgb, var(--accent) 15%, transparent)'
                                  : t === 'saree'
                                    ? 'color-mix(in srgb, var(--pink, #ec4899) 15%, transparent)'
                                    : t === 'shopify'
                                      ? 'color-mix(in srgb, #8b5cf6 15%, transparent)'
                                      : 'color-mix(in srgb, var(--success) 15%, transparent)',
                              color:
                                t === 'tryon'
                                  ? 'var(--accent)'
                                  : t === 'saree'
                                    ? 'var(--pink, #ec4899)'
                                    : t === 'shopify'
                                      ? '#8b5cf6'
                                      : 'var(--success)',
                            }}
                          >
                            {JOB_TYPE_LABELS[t]}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>Any</span>
                    )}
                  </td>
                  <td>
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '2px 8px',
                        borderRadius: 4,
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        background: `color-mix(in srgb, ${statusColor(w)} 15%, transparent)`,
                        color: statusColor(w),
                      }}
                    >
                      {w.status}
                    </span>
                  </td>
                  <td>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                        fontSize: '0.8rem',
                        color: w.healthy ? 'var(--success)' : 'var(--danger)',
                      }}
                    >
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          background: w.healthy ? 'var(--success)' : 'var(--danger)',
                          display: 'inline-block',
                        }}
                      />
                      {w.healthy ? 'Healthy' : 'Offline'}
                    </span>
                  </td>
                  <td style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>
                    {formatLastSeen(w.lastSeen)}
                  </td>
                  <td
                    style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: 'var(--muted)' }}
                  >
                    {w.apiKeyHint}
                  </td>
                  <td>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        justifyContent: 'flex-end',
                      }}
                    >
                      <Switch checked={w.isActive} onChange={() => void handleToggleActive(w)} />
                      <button
                        className="btn btn--ghost btn--sm"
                        onClick={() => openEdit(w)}
                        title="Edit"
                      >
                        <Icon.Edit />
                      </button>
                      <button
                        className="btn btn--ghost btn--sm"
                        onClick={() => void handleDelete(w)}
                        disabled={w.status === 'BUSY' || deleting === w.id}
                        title={w.status === 'BUSY' ? 'Deactivate first before deleting' : 'Delete'}
                        style={{ color: 'var(--danger)' }}
                      >
                        <Icon.Trash />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
          }}
          onClick={(e) => e.target === e.currentTarget && closeModal()}
        >
          <div
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: 28,
              width: 420,
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0 }}>{editTarget ? `Edit ${editTarget.id}` : 'Add Worker'}</h3>
              <button className="btn btn--ghost btn--sm" onClick={closeModal}>
                <Icon.Close />
              </button>
            </div>

            {!editTarget && (
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                  Worker ID <span style={{ color: 'var(--danger)' }}>*</span>
                </span>
                <input
                  className="input"
                  placeholder="worker-c"
                  value={form.id}
                  onChange={(e) => setForm((f) => ({ ...f, id: e.target.value }))}
                />
                <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>
                  Alphanumeric + dashes, e.g. worker-a
                </span>
              </label>
            )}

            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>Label</span>
              <input
                className="input"
                placeholder="GPU Server C"
                value={form.label}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
              />
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                URL <span style={{ color: 'var(--danger)' }}>*</span>
              </span>
              <input
                className="input"
                placeholder="https://1.2.3.4/"
                value={form.url}
                onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
              />
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                API Key{!editTarget && <span style={{ color: 'var(--danger)' }}> *</span>}
                {editTarget && (
                  <span style={{ marginLeft: 4, fontWeight: 400 }}>
                    (leave blank to keep current)
                  </span>
                )}
              </span>
              <input
                className="input"
                type="password"
                placeholder={editTarget ? '••••••' : 'API key'}
                value={form.apiKey}
                onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
                autoComplete="new-password"
              />
            </label>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                Job Types
                <span style={{ marginLeft: 6, fontWeight: 400 }}>
                  (leave unchecked to accept all)
                </span>
              </span>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {JOB_TYPES.map((t) => (
                  <label
                    key={t}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      cursor: 'pointer',
                      fontSize: '0.85rem',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={form.allowedJobTypes.includes(t)}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          allowedJobTypes: e.target.checked
                            ? [...f.allowedJobTypes, t]
                            : f.allowedJobTypes.filter((x) => x !== t),
                        }))
                      }
                    />
                    {JOB_TYPE_LABELS[t]}
                  </label>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
              <button className="btn btn--ghost" onClick={closeModal}>
                Cancel
              </button>
              <button
                className="btn btn--primary"
                onClick={() => void handleSave()}
                disabled={saving || !canSave}
              >
                {saving ? 'Saving…' : editTarget ? 'Save Changes' : 'Add Worker'}
              </button>
            </div>
          </div>
        </div>
      )}
      {confirmDelete && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 200,
          }}
          onClick={(e) => e.target === e.currentTarget && setConfirmDelete(null)}
        >
          <div
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: 28,
              width: 380,
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0 }}>Delete Worker</h3>
              <button className="btn btn--ghost btn--sm" onClick={() => setConfirmDelete(null)}>
                <Icon.Close />
              </button>
            </div>
            <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--muted)' }}>
              Delete{' '}
              <strong style={{ color: 'var(--text)' }}>
                {confirmDelete.label || confirmDelete.id}
              </strong>
              ? This cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn--ghost" onClick={() => setConfirmDelete(null)}>
                Cancel
              </button>
              <button
                className="btn btn--primary"
                style={{ background: 'var(--danger)', borderColor: 'var(--danger)' }}
                onClick={() => void doDelete(confirmDelete.id)}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
