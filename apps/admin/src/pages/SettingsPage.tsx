import { useEffect, useState } from 'react';
import { ConfirmModal } from '../components/ConfirmModal';
import { Icon } from '../components/Icons';
import { Switch } from '../components/Switch';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../lib/data';
import type { CreditPlan } from '../types';

interface Props {
  onNav: (_page: string, _filter?: { page: string; filter?: string }) => void;
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

const PAGE_SIZES = [15, 25, 50, 100] as const;

const EMPTY_FORM = {
  slug: '',
  name: '',
  subtext: '',
  credits: 0,
  basePaise: 0,
  isActive: true,
  isHighlighted: false,
  badge: '',
  sortOrder: 0,
};

function PlanModal({
  plan,
  onSaved,
  onClose,
  toast,
}: {
  plan: CreditPlan | null;
  onSaved: (p: CreditPlan) => void;
  onClose: () => void;
  toast: Props['toast'];
}) {
  const [form, setForm] = useState(
    plan
      ? {
          slug: plan.slug,
          name: plan.name,
          subtext: plan.subtext,
          credits: plan.credits,
          basePaise: plan.basePaise,
          isActive: plan.isActive,
          isHighlighted: plan.isHighlighted,
          badge: plan.badge ?? '',
          sortOrder: plan.sortOrder,
        }
      : EMPTY_FORM,
  );
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const handleSave = async () => {
    setSaving(true);
    try {
      const body = { ...form, badge: form.badge.trim() || null };
      const saved = plan
        ? await apiFetch<CreditPlan>(`/admin/credit-plans/${plan.id}`, {
            method: 'PATCH',
            body: JSON.stringify(body),
          })
        : await apiFetch<CreditPlan>('/admin/credit-plans', {
            method: 'POST',
            body: JSON.stringify(body),
          });
      onSaved(saved);
      toast({ title: plan ? `${saved.name} updated` : `${saved.name} created` });
      onClose();
    } catch {
      toast({ kind: 'error', title: plan ? 'Failed to update plan' : 'Failed to create plan' });
    } finally {
      setSaving(false);
    }
  };

  const valid = form.slug.trim() && form.name.trim() && form.credits > 0 && form.basePaise > 0;

  return (
    <div className="modal-overlay" onClick={saving ? undefined : onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(460px, calc(100vw - 40px))' }}
      >
        <div className="modal-head">
          <h3>{plan ? 'Edit plan' : 'Add plan'}</h3>
          <button
            className="btn sm ghost"
            onClick={onClose}
            disabled={saving}
            style={{ marginLeft: 'auto' }}
          >
            <Icon.Close />
          </button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', gap: 12 }}>
            <div className="field" style={{ flex: 1 }}>
              <label>Slug</label>
              <input
                className="input"
                value={form.slug}
                disabled={saving || !!plan}
                placeholder="e.g. starter"
                onChange={(e) =>
                  set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))
                }
              />
              {!plan && (
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                  Lowercase letters, numbers, hyphens. Cannot change after creation.
                </span>
              )}
            </div>
            <div className="field" style={{ width: 100 }}>
              <label>Sort order</label>
              <input
                className="input"
                type="number"
                min={0}
                value={form.sortOrder}
                disabled={saving}
                onChange={(e) => set('sortOrder', Number(e.target.value))}
              />
            </div>
          </div>

          <div className="field">
            <label>Name</label>
            <input
              className="input"
              value={form.name}
              disabled={saving}
              placeholder="e.g. Starter Pack"
              onChange={(e) => set('name', e.target.value)}
            />
          </div>

          <div className="field">
            <label>Subtext</label>
            <input
              className="input"
              value={form.subtext}
              disabled={saving}
              placeholder="e.g. Individual sellers & small stores"
              onChange={(e) => set('subtext', e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', gap: 12 }}>
            <div className="field" style={{ flex: 1 }}>
              <label>Credits</label>
              <input
                className="input"
                type="number"
                min={1}
                value={form.credits}
                disabled={saving}
                onChange={(e) => set('credits', Number(e.target.value))}
              />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Price (paise, excl. GST)</label>
              <input
                className="input"
                type="number"
                min={1}
                value={form.basePaise}
                disabled={saving}
                placeholder="e.g. 250000 = ₹2,500"
                onChange={(e) => set('basePaise', Number(e.target.value))}
              />
              {form.basePaise > 0 && (
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                  ₹{(form.basePaise / 100).toLocaleString('en-IN')} + 18% GST = ₹
                  {((form.basePaise * 1.18) / 100).toLocaleString('en-IN', {
                    maximumFractionDigits: 2,
                  })}
                </span>
              )}
            </div>
          </div>

          <div className="field">
            <label>Badge label (optional)</label>
            <input
              className="input"
              value={form.badge}
              disabled={saving}
              placeholder="e.g. Best Value  (leave blank for none)"
              onChange={(e) => set('badge', e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', gap: 24 }}>
            <div className="setting-row" style={{ flex: 1, margin: 0, padding: 0 }}>
              <div>
                <div className="setting-lbl">Active</div>
                <div className="setting-desc">Visible and purchasable by users</div>
              </div>
              <Switch checked={form.isActive} onChange={(v) => set('isActive', v)} />
            </div>
            <div className="setting-row" style={{ flex: 1, margin: 0, padding: 0 }}>
              <div>
                <div className="setting-lbl">Highlighted</div>
                <div className="setting-desc">Pink gradient card on pricing page</div>
              </div>
              <Switch checked={form.isHighlighted} onChange={(v) => set('isHighlighted', v)} />
            </div>
          </div>
        </div>

        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn primary" onClick={handleSave} disabled={saving || !valid}>
            {saving ? 'Saving…' : plan ? 'Save changes' : 'Create plan'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SettingsPage({ onNav: _onNav, toast, theme, onToggleTheme }: Props) {
  const { logout } = useAuth();
  const [pageSize, setPageSize] = useState<number>(25);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshInterval, setRefreshInterval] = useState(30);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [emailAlerts, setEmailAlerts] = useState(true);
  const [slackWebhook, setSlackWebhook] = useState('');
  const [saving, setSaving] = useState<string | null>(null);

  const [plans, setPlans] = useState<CreditPlan[]>([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [planModal, setPlanModal] = useState<{ open: boolean; plan: CreditPlan | null }>({
    open: false,
    plan: null,
  });
  const [confirmDelete, setConfirmDelete] = useState<CreditPlan | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    apiFetch<CreditPlan[]>('/admin/credit-plans')
      .then(setPlans)
      .catch(() => toast({ kind: 'error', title: 'Failed to load credit plans' }))
      .finally(() => setPlansLoading(false));
  }, [toast]);

  const handlePlanSaved = (saved: CreditPlan) => {
    setPlans((prev) => {
      const idx = prev.findIndex((p) => p.id === saved.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = saved;
        return next.sort((a, b) => a.sortOrder - b.sortOrder);
      }
      return [...prev, saved].sort((a, b) => a.sortOrder - b.sortOrder);
    });
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      await apiFetch(`/admin/credit-plans/${confirmDelete.id}`, { method: 'DELETE' });
      setPlans((prev) => prev.filter((p) => p.id !== confirmDelete.id));
      toast({ title: `${confirmDelete.name} deleted` });
    } catch (err) {
      const msg =
        err instanceof Error && err.message.includes('existing payments')
          ? 'Cannot delete — plan has existing payments. Deactivate it instead.'
          : 'Failed to delete plan';
      toast({ kind: 'error', title: msg });
    } finally {
      setDeleting(false);
      setConfirmDelete(null);
    }
  };

  const save = (section: string) => {
    setSaving(section);
    setTimeout(() => {
      setSaving(null);
      toast({ title: `${section} saved` });
    }, 500);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="lede">Manage appearance, notifications, and administrative preferences.</p>
        </div>
      </div>

      {/* Appearance */}
      <div className="card settings-card">
        <div className="card-head">
          <h3>
            <Icon.Settings /> Appearance
          </h3>
        </div>
        <div className="card-body">
          <div className="setting-row">
            <div>
              <div className="setting-lbl">Theme</div>
              <div className="setting-desc">Switch between light and dark mode.</div>
            </div>
            <button className="btn" onClick={onToggleTheme}>
              {theme === 'dark' ? <Icon.Sun /> : <Icon.Moon />}
              Switch to {theme === 'dark' ? 'light' : 'dark'} mode
            </button>
          </div>

          <div className="setting-row">
            <div>
              <div className="setting-lbl">Default page size</div>
              <div className="setting-desc">Items per page in tables.</div>
            </div>
            <select
              className="select"
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
            >
              {PAGE_SIZES.map((s) => (
                <option key={s} value={s}>
                  {s} items
                </option>
              ))}
            </select>
          </div>

          <div className="setting-row">
            <div>
              <div className="setting-lbl">Auto-refresh</div>
              <div className="setting-desc">Automatically refresh dashboard data.</div>
            </div>
            <Switch checked={autoRefresh} onChange={setAutoRefresh} />
          </div>

          {autoRefresh && (
            <div className="setting-row">
              <div>
                <div className="setting-lbl">Refresh interval</div>
                <div className="setting-desc">How often to poll for updates.</div>
              </div>
              <select
                className="select"
                value={refreshInterval}
                onChange={(e) => setRefreshInterval(Number(e.target.value))}
              >
                <option value={15}>15 seconds</option>
                <option value={30}>30 seconds</option>
                <option value={60}>1 minute</option>
                <option value={300}>5 minutes</option>
              </select>
            </div>
          )}

          <div className="setting-actions">
            <button className="btn" onClick={() => save('Appearance')} disabled={saving !== null}>
              {saving === 'Appearance' ? <>Saving…</> : <>Save appearance</>}
            </button>
          </div>
        </div>
      </div>

      {/* Notifications */}
      <div className="card settings-card">
        <div className="card-head">
          <h3>
            <Icon.Bell /> Notifications
          </h3>
        </div>
        <div className="card-body">
          <div className="setting-row">
            <div>
              <div className="setting-lbl">Sound alerts</div>
              <div className="setting-desc">Play a sound on job failures and warnings.</div>
            </div>
            <Switch checked={soundEnabled} onChange={setSoundEnabled} />
          </div>

          <div className="setting-row">
            <div>
              <div className="setting-lbl">Email alerts</div>
              <div className="setting-desc">Receive email notifications for critical events.</div>
            </div>
            <Switch checked={emailAlerts} onChange={setEmailAlerts} />
          </div>

          <div className="setting-row">
            <div>
              <div className="setting-lbl">Slack webhook</div>
              <div className="setting-desc">Post job status updates to a Slack channel.</div>
            </div>
            <input
              className="input"
              style={{ width: 320 }}
              placeholder="https://hooks.slack.com/services/…"
              value={slackWebhook}
              onChange={(e) => setSlackWebhook(e.target.value)}
            />
          </div>

          <div className="setting-actions">
            <button
              className="btn"
              onClick={() => save('Notifications')}
              disabled={saving !== null}
            >
              {saving === 'Notifications' ? <>Saving…</> : <>Save notifications</>}
            </button>
          </div>
        </div>
      </div>

      {/* Credit Plans */}
      <div className="card settings-card">
        <div className="card-head">
          <h3>
            <Icon.Coin /> Credit plans
          </h3>
          <div className="tools">
            <button className="btn sm" onClick={() => setPlanModal({ open: true, plan: null })}>
              <Icon.Add /> Add plan
            </button>
          </div>
        </div>
        <div className="card-body" style={{ padding: 0 }}>
          {plansLoading ? (
            <div style={{ padding: '24px 16px', color: 'var(--muted)', fontSize: 14 }}>
              Loading…
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Pack</th>
                  <th>Slug</th>
                  <th>Credits</th>
                  <th>Price (excl. GST)</th>
                  <th>Total (incl. 18% GST)</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {plans.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <span className="semi">{p.name}</span>
                      {p.badge && (
                        <span className="badge warn" style={{ marginLeft: 8 }}>
                          {p.badge}
                        </span>
                      )}
                    </td>
                    <td>
                      <span className="mono">{p.slug}</span>
                    </td>
                    <td>{p.credits.toLocaleString()}</td>
                    <td>₹{(p.basePaise / 100).toLocaleString('en-IN')}</td>
                    <td>
                      ₹
                      {((p.basePaise * 1.18) / 100).toLocaleString('en-IN', {
                        maximumFractionDigits: 2,
                      })}
                    </td>
                    <td>
                      {p.isActive ? (
                        <span className="badge dot success">Active</span>
                      ) : (
                        <span className="badge dot">Inactive</span>
                      )}
                    </td>
                    <td style={{ display: 'flex', gap: 4 }}>
                      <button
                        className="btn sm ghost"
                        onClick={() => setPlanModal({ open: true, plan: p })}
                      >
                        <Icon.Edit />
                      </button>
                      <button
                        className="btn sm ghost"
                        style={{ color: 'var(--danger)' }}
                        onClick={() => setConfirmDelete(p)}
                      >
                        <Icon.Trash />
                      </button>
                    </td>
                  </tr>
                ))}
                {plans.length === 0 && (
                  <tr>
                    <td
                      colSpan={7}
                      style={{ textAlign: 'center', color: 'var(--muted)', padding: 24 }}
                    >
                      No plans yet — click "Add plan" to create one.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Session */}
      <div className="card settings-card">
        <div className="card-head">
          <h3>
            <Icon.Logout /> Session
          </h3>
        </div>
        <div className="card-body">
          <div className="setting-row">
            <div>
              <div className="setting-lbl">Sign out</div>
              <div className="setting-desc">End your current admin session.</div>
            </div>
            <button className="btn danger" onClick={() => logout()}>
              <Icon.Logout /> Sign out
            </button>
          </div>
        </div>
      </div>

      {planModal.open && (
        <PlanModal
          plan={planModal.plan}
          onSaved={handlePlanSaved}
          onClose={() => setPlanModal({ open: false, plan: null })}
          toast={toast}
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          title="Delete plan"
          body={`Are you sure you want to delete "${confirmDelete.name}"? This cannot be undone.`}
          what={`slug: ${confirmDelete.slug}`}
          danger
          confirmLabel={deleting ? 'Deleting…' : 'Delete'}
          onConfirm={handleDelete}
          onClose={() => setConfirmDelete(null)}
        />
      )}
    </>
  );
}
