import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ConfirmModal } from '../components/ConfirmModal';
import { Icon } from '../components/Icons';
import { SearchableSelect } from '../components/SearchableSelect';
import { Switch } from '../components/Switch';
import { useAuth } from '../context/AuthContext';
import { apiErrorMessage, apiFetch } from '../lib/data';

type Theme = 'light' | 'dark' | 'system';

import type { CreditPlan } from '../types';

type SettingsSection = 'appearance' | 'notifications' | 'credit-plans' | 'system' | 'session';

const SETTING_SECTIONS: { k: SettingsSection; label: string }[] = [
  { k: 'appearance', label: 'Appearance' },
  { k: 'notifications', label: 'Notifications' },
  { k: 'credit-plans', label: 'Credit Plans' },
  { k: 'system', label: 'System' },
  { k: 'session', label: 'Session' },
];

interface Props {
  onNav: (_page: string, _filter?: { page: string; filter?: string }) => void;
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const PAGE_SIZES = [15, 25, 50, 100] as const;

const EMPTY_FORM = {
  slug: '',
  name: '',
  subtext: '',
  credits: 0,
  priceRupees: 0,
  isActive: true,
  isHighlighted: false,
  badge: '',
  sortOrder: 0,
  queueStream: 'normal' as 'priority' | 'normal' | 'low',
  watermark: false,
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
          priceRupees: plan.basePaise / 100,
          isActive: plan.isActive,
          isHighlighted: plan.isHighlighted,
          badge: plan.badge ?? '',
          sortOrder: plan.sortOrder,
          queueStream: plan.queueStream ?? ('normal' as 'priority' | 'normal' | 'low'),
          watermark: plan.watermark ?? false,
        }
      : EMPTY_FORM,
  );
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const handleSave = async () => {
    setSaving(true);
    try {
      const { priceRupees, ...rest } = form;
      const body = {
        ...rest,
        basePaise: Math.round(priceRupees * 100),
        badge: form.badge.trim() || null,
      };
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
    } catch (err) {
      toast({
        kind: 'error',
        title: plan ? 'Failed to update plan' : 'Failed to create plan',
        body: apiErrorMessage(err, 'Please try again.'),
      });
    } finally {
      setSaving(false);
    }
  };

  const isFreePlan = plan?.slug === 'free';
  const valid =
    form.slug.trim() &&
    form.name.trim() &&
    form.credits >= 0 &&
    form.priceRupees >= 0 &&
    (isFreePlan || (form.credits > 0 && form.priceRupees > 0));

  return (
    <div className="modal-overlay" onClick={saving ? undefined : onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <h2>{plan ? 'Edit plan' : 'Add plan'}</h2>
          <button
            className="btn sm ghost"
            onClick={onClose}
            disabled={saving}
            style={{ marginLeft: 'auto' }}
          >
            <Icon.Close />
          </button>
        </div>

        <div className="drawer-body" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Identity Group */}
          <div style={{ display: 'flex', gap: 16 }}>
            <div className="field" style={{ flex: 1 }}>
              <label>Slug (Identifier)</label>
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
                  Lowercase letters, numbers, hyphens. Cannot change later.
                </span>
              )}
            </div>
            <div className="field" style={{ flex: 1.5 }}>
              <label>Plan Name</label>
              <input
                className="input"
                value={form.name}
                disabled={saving}
                placeholder="e.g. Starter Pack"
                onChange={(e) => set('name', e.target.value)}
              />
            </div>
          </div>

          <div className="field">
            <label>Subtext Description</label>
            <input
              className="input"
              value={form.subtext}
              disabled={saving}
              placeholder="e.g. Individual sellers & small stores"
              onChange={(e) => set('subtext', e.target.value)}
            />
          </div>

          <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />

          {/* Value Group */}
          <div style={{ display: 'flex', gap: 16 }}>
            <div className="field" style={{ flex: 1 }}>
              <label>{isFreePlan ? 'Signup credits' : 'Credit Allocation'}</label>
              <input
                className="input"
                type="number"
                min={0}
                value={form.credits}
                disabled={saving}
                onChange={(e) => set('credits', Number(e.target.value))}
              />
              {isFreePlan && (
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                  Granted once to every new signup. Set to 0 to disable.
                </span>
              )}
            </div>
            {!isFreePlan && (
              <div className="field" style={{ flex: 1 }}>
                <label>Price (₹, excl. GST)</label>
                <div style={{ position: 'relative' }}>
                  <span
                    style={{
                      position: 'absolute',
                      left: 12,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      fontSize: 14,
                      color: 'var(--muted)',
                      pointerEvents: 'none',
                    }}
                  >
                    ₹
                  </span>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    step={1}
                    value={form.priceRupees || ''}
                    disabled={saving}
                    placeholder="e.g. 2500"
                    style={{ paddingLeft: 26 }}
                    onChange={(e) => set('priceRupees', Number(e.target.value))}
                  />
                </div>
                {form.priceRupees > 0 && (
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                    ₹{form.priceRupees.toLocaleString('en-IN')} + 18% GST = ₹
                    {(form.priceRupees * 1.18).toLocaleString('en-IN', {
                      maximumFractionDigits: 2,
                    })}
                  </span>
                )}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 16 }}>
            <div className="field" style={{ flex: 1.5 }}>
              <label>Job Queue Priority</label>
              <select
                className="input"
                value={form.queueStream}
                disabled={saving}
                onChange={(e) =>
                  set('queueStream', e.target.value as 'priority' | 'normal' | 'low')
                }
              >
                <option value="priority">1st — Priority (jobs processed first)</option>
                <option value="normal">2nd — Normal</option>
                <option value="low">3rd — Low (processed last)</option>
              </select>
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Marketing Badge</label>
              <input
                className="input"
                value={form.badge}
                disabled={saving}
                placeholder="e.g. Best Value"
                onChange={(e) => set('badge', e.target.value)}
              />
            </div>
          </div>

          <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />

          {/* Settings Group */}
          <div
            style={{
              display: 'flex',
              gap: 24,
              alignItems: 'center',
              background: 'var(--surface-2)',
              padding: 16,
              borderRadius: 'var(--r-lg)',
              border: '1px solid var(--border)',
            }}
          >
            <div className="field" style={{ width: 100, marginBottom: 0 }}>
              <label>Sort order</label>
              <input
                className="input"
                type="number"
                min={0}
                value={form.sortOrder}
                disabled={saving}
                style={{ background: 'var(--surface)' }}
                onChange={(e) => set('sortOrder', Number(e.target.value))}
              />
            </div>

            <div style={{ width: 1, height: 40, background: 'var(--border)' }} />

            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 32 }}>
              {!isFreePlan && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Switch checked={form.isActive} onChange={(v) => set('isActive', v)} />
                  <div>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        color: 'var(--ink)',
                        lineHeight: 1.2,
                      }}
                    >
                      Active
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                      Purchasable
                    </div>
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Switch checked={form.isHighlighted} onChange={(v) => set('isHighlighted', v)} />
                <div>
                  <div
                    style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.2 }}
                  >
                    Featured
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                    Accent styling
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Switch checked={form.watermark} onChange={(v) => set('watermark', v)} />
                <div>
                  <div
                    style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.2 }}
                  >
                    Watermark
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                    Apply logo to jobs
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="drawer-foot">
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

export default function SettingsPage({ onNav: _onNav, toast, theme, setTheme }: Props) {
  const { logout } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const section = (searchParams.get('s') as SettingsSection | null) ?? 'appearance';
  const [pageSize, setPageSize] = useState<number>(25);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

  const [resolutions, setResolutions] = useState<
    Record<string, { enabled: boolean; creditCost: number }>
  >({
    HD: { enabled: false, creditCost: 10 },
    '2K': { enabled: true, creditCost: 25 },
    '4K': { enabled: true, creditCost: 40 },
  });
  const [maxOutputPx, setMaxOutputPx] = useState(2048);
  const [merchantCatalogDefaults, setMerchantCatalogDefaults] = useState<
    Record<string, { faceId: string; backgroundId: string }>
  >({});
  const [merchantCatalogAspectRatio, setMerchantCatalogAspectRatio] = useState('2:3');
  const [modelFacesList, setModelFacesList] = useState<
    Array<{ id: string; label: string; gender: string }>
  >([]);
  const [modelBackgroundsList, setModelBackgroundsList] = useState<
    Array<{ id: string; label: string }>
  >([]);
  const [tryonCreditCost, setTryonCreditCost] = useState(5);
  const [sareeMannequinDevCreditCost, setSareeMannequinDevCreditCost] = useState(10);
  const [uploadLimitsMb, setUploadLimitsMb] = useState({
    merchantCatalogMaxBytes: 20,
    webGarmentMaxBytes: 20,
    merchantTryonMaxBytes: 20,
    kioskUploadMaxBytes: 20,
    devApiMaxBytes: 20,
    shopifyCatalogSourceMaxBytes: 20,
    shopifyCustomerPhotoMaxBytes: 20,
    shopifyProductImageMaxBytes: 20,
    shopifyProductSyncMaxBytes: 20,
  });
  const [bulkImportMaxGb, setBulkImportMaxGb] = useState(2.5);
  const [sysLoading, setSysLoading] = useState(true);
  const [sysSaving, setSysSaving] = useState(false);

  const [plans, setPlans] = useState<CreditPlan[]>([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [planModal, setPlanModal] = useState<{ open: boolean; plan: CreditPlan | null }>({
    open: false,
    plan: null,
  });
  const [confirmDelete, setConfirmDelete] = useState<CreditPlan | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    apiFetch<{
      resolutions?: Record<string, { enabled: boolean; creditCost: number }>;
      maxOutputPx?: number;
      merchantCatalogDefaults?: Record<string, { faceId: string; backgroundId: string }>;
      merchantCatalogAspectRatio?: string;
      tryon?: { creditCost: number };
      sareeMannequinDev?: { creditCost: number };
      uploadLimits?: Record<string, number>;
    }>('/admin/config')
      .then((cfg) => {
        if (cfg.resolutions) setResolutions(cfg.resolutions);
        if (cfg.maxOutputPx) setMaxOutputPx(cfg.maxOutputPx);
        if (cfg.merchantCatalogDefaults) setMerchantCatalogDefaults(cfg.merchantCatalogDefaults);
        if (cfg.merchantCatalogAspectRatio)
          setMerchantCatalogAspectRatio(cfg.merchantCatalogAspectRatio);
        if (cfg.tryon) setTryonCreditCost(cfg.tryon.creditCost);
        if (cfg.sareeMannequinDev) setSareeMannequinDevCreditCost(cfg.sareeMannequinDev.creditCost);
        if (cfg.uploadLimits) {
          const bytesToMb = (b: number) => Math.round((b / (1024 * 1024)) * 100) / 100;
          setUploadLimitsMb({
            merchantCatalogMaxBytes: bytesToMb(
              cfg.uploadLimits.merchantCatalogMaxBytes ?? 20 * 1024 * 1024,
            ),
            webGarmentMaxBytes: bytesToMb(cfg.uploadLimits.webGarmentMaxBytes ?? 20 * 1024 * 1024),
            merchantTryonMaxBytes: bytesToMb(
              cfg.uploadLimits.merchantTryonMaxBytes ?? 20 * 1024 * 1024,
            ),
            kioskUploadMaxBytes: bytesToMb(
              cfg.uploadLimits.kioskUploadMaxBytes ?? 20 * 1024 * 1024,
            ),
            devApiMaxBytes: bytesToMb(cfg.uploadLimits.devApiMaxBytes ?? 20 * 1024 * 1024),
            shopifyCatalogSourceMaxBytes: bytesToMb(
              cfg.uploadLimits.shopifyCatalogSourceMaxBytes ?? 20 * 1024 * 1024,
            ),
            shopifyCustomerPhotoMaxBytes: bytesToMb(
              cfg.uploadLimits.shopifyCustomerPhotoMaxBytes ?? 20 * 1024 * 1024,
            ),
            shopifyProductImageMaxBytes: bytesToMb(
              cfg.uploadLimits.shopifyProductImageMaxBytes ?? 20 * 1024 * 1024,
            ),
            shopifyProductSyncMaxBytes: bytesToMb(
              cfg.uploadLimits.shopifyProductSyncMaxBytes ?? 20 * 1024 * 1024,
            ),
          });
          const bytesToGb = (b: number) => Math.round((b / (1024 * 1024 * 1024)) * 100) / 100;
          setBulkImportMaxGb(
            bytesToGb(cfg.uploadLimits.bulkImportMaxBytes ?? 2.5 * 1024 * 1024 * 1024),
          );
        }
      })
      .catch((e) =>
        toast({
          kind: 'error',
          title: 'Failed to load system config',
          body: apiErrorMessage(e, 'Please try again.'),
        }),
      )
      .finally(() => setSysLoading(false));
  }, [toast]);

  useEffect(() => {
    apiFetch<{ items: Array<{ id: string; label: string; gender: string }> }>('/admin/assets/faces')
      .then((res) => setModelFacesList(res.items))
      .catch(() => {});
    apiFetch<{ items: Array<{ id: string; label: string }> }>('/admin/assets/backgrounds')
      .then((res) => setModelBackgroundsList(res.items))
      .catch(() => {});
  }, []);

  const saveSysConfig = async () => {
    setSysSaving(true);
    try {
      const mbToBytes = (mb: number) => Math.round(mb * 1024 * 1024);
      const gbToBytes = (gb: number) => Math.round(gb * 1024 * 1024 * 1024);
      await apiFetch('/admin/config', {
        method: 'PATCH',
        body: JSON.stringify({
          resolutions,
          maxOutputPx,
          merchantCatalogDefaults,
          merchantCatalogAspectRatio,
          tryon: { creditCost: tryonCreditCost },
          sareeMannequinDev: { creditCost: sareeMannequinDevCreditCost },
          uploadLimits: {
            merchantCatalogMaxBytes: mbToBytes(uploadLimitsMb.merchantCatalogMaxBytes),
            webGarmentMaxBytes: mbToBytes(uploadLimitsMb.webGarmentMaxBytes),
            merchantTryonMaxBytes: mbToBytes(uploadLimitsMb.merchantTryonMaxBytes),
            kioskUploadMaxBytes: mbToBytes(uploadLimitsMb.kioskUploadMaxBytes),
            devApiMaxBytes: mbToBytes(uploadLimitsMb.devApiMaxBytes),
            shopifyCatalogSourceMaxBytes: mbToBytes(uploadLimitsMb.shopifyCatalogSourceMaxBytes),
            shopifyCustomerPhotoMaxBytes: mbToBytes(uploadLimitsMb.shopifyCustomerPhotoMaxBytes),
            shopifyProductImageMaxBytes: mbToBytes(uploadLimitsMb.shopifyProductImageMaxBytes),
            shopifyProductSyncMaxBytes: mbToBytes(uploadLimitsMb.shopifyProductSyncMaxBytes),
            bulkImportMaxBytes: gbToBytes(bulkImportMaxGb),
          },
        }),
      });
      toast({ title: 'System config saved' });
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to save system config',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    } finally {
      setSysSaving(false);
    }
  };

  useEffect(() => {
    apiFetch<CreditPlan[]>('/admin/credit-plans')
      .then(setPlans)
      .catch((e) =>
        toast({
          kind: 'error',
          title: 'Failed to load credit plans',
          body: apiErrorMessage(e, 'Please try again.'),
        }),
      )
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
      toast({
        kind: 'error',
        title: 'Failed to delete plan',
        body: apiErrorMessage(err, 'Please try again.'),
      });
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

  const freePlan = plans.find((plan) => plan.slug === 'free') ?? null;
  const paidPlans = plans.filter((plan) => plan.slug !== 'free');

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="lede">Manage appearance, notifications, and administrative preferences.</p>
        </div>
      </div>

      <div className="tabs">
        {SETTING_SECTIONS.map((s) => (
          <button
            key={s.k}
            className={`tab ${section === s.k ? 'active' : ''}`}
            onClick={() => setSearchParams({ s: s.k })}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Appearance */}
      {section === 'appearance' && (
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
                <div className="setting-desc">Choose light, dark, or match your system.</div>
              </div>
              <div className="btn-group">
                {(['light', 'dark', 'system'] as const).map((t) => (
                  <button
                    key={t}
                    className={`btn sm ${theme === t ? 'primary' : ''}`}
                    onClick={() => setTheme(t)}
                    aria-pressed={theme === t}
                  >
                    {t === 'light' && <Icon.Sun />}
                    {t === 'dark' && <Icon.Moon />}
                    {t === 'system' && <Icon.Monitor />}
                    {t[0].toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
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

            <div className="setting-actions">
              <button className="btn" onClick={() => save('Appearance')} disabled={saving !== null}>
                {saving === 'Appearance' ? <>Saving…</> : <>Save appearance</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Notifications */}
      {section === 'notifications' && (
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

            <div className="setting-row" style={{ opacity: 0.6 }}>
              <div>
                <div className="setting-lbl">
                  Email alerts{' '}
                  <span className="badge" style={{ marginLeft: 6 }}>
                    Coming soon
                  </span>
                </div>
                <div className="setting-desc">Receive email notifications for critical events.</div>
              </div>
              <Switch checked={false} onChange={() => {}} disabled />
            </div>

            <div className="setting-row" style={{ opacity: 0.6 }}>
              <div>
                <div className="setting-lbl">
                  Slack webhook{' '}
                  <span className="badge" style={{ marginLeft: 6 }}>
                    Coming soon
                  </span>
                </div>
                <div className="setting-desc">Post job status updates to a Slack channel.</div>
              </div>
              <input
                className="input"
                style={{ width: 320 }}
                placeholder="https://hooks.slack.com/services/…"
                value=""
                onChange={() => {}}
                disabled
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
      )}

      {/* Credit Plans */}
      {section === 'credit-plans' && (
        <>
          <div
            style={{
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-lg)',
              padding: '24px 32px',
              display: 'flex',
              alignItems: 'center',
              gap: 40,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ flex: 1, minWidth: 280 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <div
                  style={{
                    background: 'var(--ink)',
                    color: 'var(--bg)',
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Icon.Coin style={{ width: 16, height: 16 }} />
                </div>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: 'var(--ink)' }}>
                  Free Signup Plan
                </h3>
              </div>
              <div style={{ color: 'var(--muted)', fontSize: 14, lineHeight: 1.5, maxWidth: 500 }}>
                New users are automatically granted a one-time credit allocation at signup. This
                system-owned plan is permanent and free.
              </div>
            </div>

            {plansLoading ? (
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>Loading…</div>
            ) : freePlan ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
                <div>
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      marginBottom: 4,
                    }}
                  >
                    Allocation
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                    <div
                      style={{
                        fontSize: 32,
                        fontWeight: 700,
                        letterSpacing: '-0.02em',
                        color: 'var(--ink)',
                      }}
                    >
                      {freePlan.credits.toLocaleString()}
                    </div>
                    <div style={{ fontSize: 14, color: 'var(--muted)' }}>credits</div>
                  </div>
                </div>

                <div style={{ width: 1, height: 48, background: 'var(--border)' }} />

                <div>
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      marginBottom: 4,
                    }}
                  >
                    Queue
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 500, color: 'var(--ink)', marginTop: 8 }}>
                    {freePlan.queueStream === 'priority'
                      ? 'Priority'
                      : freePlan.queueStream === 'normal'
                        ? 'Normal'
                        : 'Low'}
                  </div>
                </div>

                <div style={{ marginLeft: 16 }}>
                  <button
                    className="btn"
                    onClick={() => setPlanModal({ open: true, plan: freePlan })}
                  >
                    <Icon.Edit /> Edit
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ color: 'var(--danger)', fontSize: 13 }}>
                Free plan missing. Run migrations to seed it.
              </div>
            )}
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 20,
              marginTop: 32,
            }}
          >
            <h3
              style={{
                margin: 0,
                fontSize: 18,
                fontWeight: 500,
                color: 'var(--ink)',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <Icon.Coin /> Paid Credit Plans
            </h3>
            <button
              className="btn sm primary"
              onClick={() => setPlanModal({ open: true, plan: null })}
            >
              <Icon.Add /> Add paid plan
            </button>
          </div>

          {plansLoading ? (
            <div style={{ color: 'var(--muted)', fontSize: 13 }}>Loading…</div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 24 }}>
              {paidPlans.map((p) => (
                <div
                  key={p.id}
                  className="card"
                  style={{
                    flex: '1 1 300px',
                    maxWidth: 380,
                    padding: 24,
                    display: 'flex',
                    flexDirection: 'column',
                    position: 'relative',
                    overflow: 'hidden',
                    opacity: p.isActive ? 1 : 0.6,
                    borderColor: p.isHighlighted && p.isActive ? 'var(--accent)' : 'var(--border)',
                  }}
                >
                  {p.isHighlighted && p.isActive && (
                    <div
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        height: 4,
                        background: 'var(--accent)',
                      }}
                    />
                  )}

                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      marginBottom: 16,
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1, paddingRight: 8 }}>
                      <div
                        style={{
                          fontSize: 16,
                          fontWeight: 600,
                          color: 'var(--ink)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {p.name}
                      </div>
                      <div
                        className="mono"
                        style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}
                      >
                        {p.slug}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                      {p.badge && <span className="badge warn">{p.badge}</span>}
                      {!p.isActive && <span className="badge dot">Inactive</span>}
                    </div>
                  </div>

                  <div style={{ marginBottom: 24 }}>
                    <div
                      style={{
                        fontSize: 28,
                        fontWeight: 700,
                        letterSpacing: '-0.02em',
                        color: 'var(--ink)',
                      }}
                    >
                      ₹
                      {((p.basePaise * 1.18) / 100).toLocaleString('en-IN', {
                        maximumFractionDigits: 2,
                      })}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                      ₹{(p.basePaise / 100).toLocaleString('en-IN')} + 18% GST
                    </div>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 12,
                      marginBottom: 28,
                      flex: 1,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        fontSize: 13.5,
                        color: 'var(--ink)',
                      }}
                    >
                      <Icon.Coin style={{ color: 'var(--accent)', width: 16, height: 16 }} />
                      <span>
                        <strong className="mono">{p.credits.toLocaleString()}</strong> credits
                      </span>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        fontSize: 13.5,
                        color: 'var(--muted)',
                      }}
                    >
                      <Icon.Workflow style={{ width: 16, height: 16 }} />
                      <span>
                        {p.queueStream === 'priority'
                          ? 'Priority'
                          : p.queueStream === 'normal'
                            ? 'Normal'
                            : 'Low'}{' '}
                        queue processing
                      </span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
                    <button
                      className="btn sm"
                      style={{ flex: 1, justifyContent: 'center' }}
                      onClick={() => setPlanModal({ open: true, plan: p })}
                    >
                      Edit Plan
                    </button>
                    <button
                      className="btn sm ghost"
                      style={{ color: 'var(--danger)', padding: '0 10px' }}
                      onClick={() => setConfirmDelete(p)}
                      title="Delete Plan"
                    >
                      <Icon.Trash />
                    </button>
                  </div>
                </div>
              ))}

              {paidPlans.length === 0 && (
                <div
                  style={{
                    gridColumn: '1 / -1',
                    textAlign: 'center',
                    padding: '40px 20px',
                    color: 'var(--muted)',
                    background: 'var(--surface-2)',
                    borderRadius: 'var(--r-lg)',
                    border: '1px dashed var(--border)',
                  }}
                >
                  No paid plans yet — click "Add paid plan" to create one.
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* System */}
      {section === 'system' && (
        <div className="card settings-card">
          <div className="card-head">
            <h3>
              <Icon.Settings /> System Configuration
            </h3>
          </div>
          <div className="card-body">
            {sysLoading ? (
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>Loading…</div>
            ) : (
              <>
                <div style={{ marginTop: 24, marginBottom: 8 }}>
                  <div className="setting-lbl" style={{ marginBottom: 4 }}>
                    Resolution Pricing
                  </div>
                  <div className="setting-desc" style={{ marginBottom: 12 }}>
                    Credit cost per image for each resolution. Disable resolutions to hide them from
                    the pricing page.
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {(['HD', '2K', '4K'] as const).map((res) => {
                      const cfg = resolutions[res] ?? { enabled: false, creditCost: 0 };
                      return (
                        <div
                          key={res}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 12,
                            padding: '10px 12px',
                            border: '1px solid var(--border)',
                            borderRadius: 'var(--r)',
                            background: 'var(--surface-2)',
                          }}
                        >
                          <Switch
                            checked={cfg.enabled}
                            onChange={(v) =>
                              setResolutions((prev) => ({
                                ...prev,
                                [res]: { ...cfg, enabled: v },
                              }))
                            }
                          />
                          <span className="setting-lbl" style={{ width: 32 }}>
                            {res}
                          </span>
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                              marginLeft: 'auto',
                            }}
                          >
                            <input
                              className="input"
                              type="number"
                              min={1}
                              max={1000}
                              style={{ width: 80, textAlign: 'right' }}
                              value={cfg.creditCost}
                              disabled={sysSaving || !cfg.enabled}
                              onChange={(e) =>
                                setResolutions((prev) => ({
                                  ...prev,
                                  [res]: { ...cfg, creditCost: Number(e.target.value) },
                                }))
                              }
                            />
                            <span
                              style={{ fontSize: 13, color: 'var(--muted)', whiteSpace: 'nowrap' }}
                            >
                              credits / image
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div style={{ marginTop: 24, marginBottom: 8 }}>
                  <div className="setting-lbl" style={{ marginBottom: 4 }}>
                    Max Output Resolution
                  </div>
                  <div className="setting-desc" style={{ marginBottom: 12 }}>
                    Platform-wide ceiling on the long edge of a generated image, in pixels. Applies
                    to every job regardless of which workflow produced it.
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '10px 12px',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--r)',
                      background: 'var(--surface-2)',
                      maxWidth: 260,
                    }}
                  >
                    <input
                      className="input"
                      type="number"
                      min={512}
                      max={4096}
                      style={{ width: 100 }}
                      value={maxOutputPx}
                      disabled={sysSaving}
                      onChange={(e) => setMaxOutputPx(Number(e.target.value))}
                    />
                    <span style={{ fontSize: 13, color: 'var(--muted)' }}>px, long edge</span>
                  </div>
                </div>

                <div style={{ marginTop: 24, marginBottom: 8 }}>
                  <div className="setting-lbl" style={{ marginBottom: 4 }}>
                    Virtual Try-On Pricing
                  </div>
                  <div className="setting-desc" style={{ marginBottom: 12 }}>
                    Credit cost per virtual try-on generation (studio "reuse as try-on" and saree
                    try-on both share this cost).
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '10px 12px',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--r)',
                      background: 'var(--surface-2)',
                    }}
                  >
                    <span className="setting-lbl">Try-On</span>
                    <div
                      style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}
                    >
                      <input
                        className="input"
                        type="number"
                        min={1}
                        max={1000}
                        style={{ width: 80, textAlign: 'right' }}
                        value={tryonCreditCost}
                        disabled={sysSaving}
                        onChange={(e) => setTryonCreditCost(Number(e.target.value))}
                      />
                      <span style={{ fontSize: 13, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                        credits / try-on
                      </span>
                    </div>
                  </div>
                </div>

                <div style={{ marginTop: 24, marginBottom: 8 }}>
                  <div className="setting-lbl" style={{ marginBottom: 4 }}>
                    Dev API — Saree Mannequin
                  </div>
                  <div className="setting-desc" style={{ marginBottom: 12 }}>
                    Credit cost per saree-mannequin (step-1) job created via the developer API (
                    <code>/v1/dev/saree-mannequin</code>). Independent of the Virtual Try-On cost
                    above.
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '10px 12px',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--r)',
                      background: 'var(--surface-2)',
                    }}
                  >
                    <span className="setting-lbl">Saree Mannequin (Dev API)</span>
                    <div
                      style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}
                    >
                      <input
                        className="input"
                        type="number"
                        min={1}
                        max={1000}
                        style={{ width: 80, textAlign: 'right' }}
                        value={sareeMannequinDevCreditCost}
                        disabled={sysSaving}
                        onChange={(e) => setSareeMannequinDevCreditCost(Number(e.target.value))}
                      />
                      <span style={{ fontSize: 13, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                        credits / job
                      </span>
                    </div>
                  </div>
                </div>

                <div style={{ marginTop: 24, marginBottom: 8 }}>
                  <div className="setting-lbl" style={{ marginBottom: 4 }}>
                    Upload Limits
                  </div>
                  <div className="setting-desc" style={{ marginBottom: 12 }}>
                    Maximum accepted file size per upload surface. Existing uploads already in
                    progress are unaffected; this only applies to uploads made after saving.
                  </div>
                  {(
                    [
                      ['merchantCatalogMaxBytes', 'Merchant catalogue (Android flat photo)'],
                      ['webGarmentMaxBytes', 'Studio / web garment upload'],
                      ['merchantTryonMaxBytes', 'Merchant try-on customer photo'],
                      ['kioskUploadMaxBytes', 'Kiosk customer photo'],
                      ['devApiMaxBytes', 'Dev API upload'],
                      ['shopifyCatalogSourceMaxBytes', 'Shopify catalogue source image'],
                      ['shopifyCustomerPhotoMaxBytes', 'Shopify storefront customer photo'],
                      ['shopifyProductImageMaxBytes', 'Shopify product-image import'],
                      ['shopifyProductSyncMaxBytes', 'Shopify webhook product sync'],
                    ] as const
                  ).map(([key, label]) => (
                    <div
                      key={key}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '10px 12px',
                        marginBottom: 8,
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--r)',
                        background: 'var(--surface-2)',
                      }}
                    >
                      <span className="setting-lbl">{label}</span>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          marginLeft: 'auto',
                        }}
                      >
                        <input
                          className="input"
                          type="number"
                          min={0}
                          max={50}
                          step={0.1}
                          style={{ width: 80, textAlign: 'right' }}
                          value={uploadLimitsMb[key]}
                          disabled={sysSaving}
                          onChange={(e) =>
                            setUploadLimitsMb((prev) => ({
                              ...prev,
                              [key]: Number(e.target.value),
                            }))
                          }
                        />
                        <span style={{ fontSize: 13, color: 'var(--muted)' }}>MB</span>
                      </div>
                    </div>
                  ))}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '10px 12px',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--r)',
                      background: 'var(--surface-2)',
                    }}
                  >
                    <span className="setting-lbl">Admin bulk-import ZIP</span>
                    <div
                      style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}
                    >
                      <input
                        className="input"
                        type="number"
                        min={0}
                        max={3}
                        step={0.1}
                        style={{ width: 80, textAlign: 'right' }}
                        value={bulkImportMaxGb}
                        disabled={sysSaving}
                        onChange={(e) => setBulkImportMaxGb(Number(e.target.value))}
                      />
                      <span style={{ fontSize: 13, color: 'var(--muted)' }}>GB</span>
                    </div>
                  </div>
                </div>

                <div style={{ marginTop: 24, marginBottom: 8 }}>
                  <div className="setting-lbl" style={{ marginBottom: 4 }}>
                    Merchant Catalogue Defaults
                  </div>
                  <div className="setting-desc" style={{ marginBottom: 12 }}>
                    Fixed model/background used when a merchant generates a catalogue image from a
                    flat garment photo — guarantees every generated image is try-on-suitable.
                  </div>
                  {(['men', 'women', 'boys', 'girls'] as const).map((cat) => (
                    <div
                      key={cat}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '80px 1fr 1fr',
                        gap: 12,
                        alignItems: 'center',
                        marginBottom: 10,
                      }}
                    >
                      <label style={{ textTransform: 'capitalize' }}>{cat}</label>
                      <SearchableSelect
                        options={modelFacesList.filter((f) => f.gender === cat)}
                        value={merchantCatalogDefaults[cat]?.faceId ?? ''}
                        disabled={sysSaving}
                        placeholder="— search face —"
                        onChange={(faceId) =>
                          setMerchantCatalogDefaults((prev) => ({
                            ...prev,
                            [cat]: {
                              ...prev[cat],
                              faceId,
                              backgroundId: prev[cat]?.backgroundId ?? '',
                            },
                          }))
                        }
                      />
                      <SearchableSelect
                        options={modelBackgroundsList}
                        value={merchantCatalogDefaults[cat]?.backgroundId ?? ''}
                        disabled={sysSaving}
                        placeholder="— search background —"
                        onChange={(backgroundId) =>
                          setMerchantCatalogDefaults((prev) => ({
                            ...prev,
                            [cat]: { faceId: prev[cat]?.faceId ?? '', backgroundId },
                          }))
                        }
                      />
                    </div>
                  ))}
                  <div style={{ maxWidth: 200 }}>
                    <div className="setting-lbl" style={{ marginBottom: 4 }}>
                      Aspect ratio
                    </div>
                    <select
                      className="select"
                      value={merchantCatalogAspectRatio}
                      disabled={sysSaving}
                      onChange={(e) => setMerchantCatalogAspectRatio(e.target.value)}
                    >
                      <option value="1:1">1:1</option>
                      <option value="2:3">2:3</option>
                      <option value="3:4">3:4</option>
                      <option value="4:5">4:5</option>
                    </select>
                  </div>
                </div>

                <div className="setting-actions">
                  <button
                    className="btn primary"
                    onClick={saveSysConfig}
                    disabled={
                      sysSaving ||
                      !Number.isInteger(maxOutputPx) ||
                      maxOutputPx < 512 ||
                      maxOutputPx > 4096
                    }
                  >
                    {sysSaving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Session */}
      {section === 'session' && (
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
      )}

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
