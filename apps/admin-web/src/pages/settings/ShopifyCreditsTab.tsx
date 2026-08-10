import { useEffect, useState } from 'react';
import { Icon } from '../../components/Icons';
import { apiErrorMessage, apiFetch } from '../../lib/data';

interface Props {
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
}

export default function ShopifyCreditsTab({ toast }: Props) {
  const [shopifyTrialCredits, setShopifyTrialCredits] = useState(25);
  const [shopifyPlanCredits, setShopifyPlanCredits] = useState({
    starter: 1925,
    growth: 5000,
    pro: 22000,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch<{
      shopify?: {
        trialCredits: number;
        planCredits?: { starter: number; growth: number; pro: number };
      };
    }>('/admin/config')
      .then((cfg) => {
        if (cfg.shopify) {
          setShopifyTrialCredits(cfg.shopify.trialCredits);
          if (cfg.shopify.planCredits) setShopifyPlanCredits(cfg.shopify.planCredits);
        }
      })
      .catch((e) =>
        toast({
          kind: 'error',
          title: 'Failed to load Shopify credits',
          body: apiErrorMessage(e, 'Please try again.'),
        }),
      )
      .finally(() => setLoading(false));
  }, [toast]);

  const save = async () => {
    setSaving(true);
    try {
      await apiFetch('/admin/config', {
        method: 'PATCH',
        body: JSON.stringify({
          shopify: { trialCredits: shopifyTrialCredits, planCredits: shopifyPlanCredits },
        }),
      });
      toast({ title: 'Shopify credits saved' });
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to save Shopify credits',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card settings-card">
      <div className="card-head">
        <h3>
          <Icon.Coin /> Shopify
        </h3>
      </div>
      <div className="card-body">
        {loading ? (
          <div style={{ color: 'var(--muted)', fontSize: 13 }}>Loading…</div>
        ) : (
          <>
            <div style={{ marginTop: 24, marginBottom: 8 }}>
              <div className="setting-lbl" style={{ marginBottom: 4 }}>
                Shopify Free Trial
              </div>
              <div className="setting-desc" style={{ marginBottom: 12 }}>
                Credits granted once, automatically, the first time a Shopify store links to an
                AiVastra account — before the merchant picks a paid plan. Independent of any
                day-based trial configured in Partner Dashboard.
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
                <span className="setting-lbl">Trial Credits</span>
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}
                >
                  <input
                    className="input"
                    type="number"
                    min={0}
                    max={1000}
                    style={{ width: 80, textAlign: 'right' }}
                    value={shopifyTrialCredits}
                    disabled={saving}
                    onChange={(e) => setShopifyTrialCredits(Number(e.target.value))}
                  />
                  <span style={{ fontSize: 13, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                    credits / store
                  </span>
                </div>
              </div>
              <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
                {(['starter', 'growth', 'pro'] as const).map((plan) => (
                  <div
                    key={plan}
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
                    <span className="setting-lbl" style={{ textTransform: 'capitalize' }}>
                      {plan}
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
                        max={1000000}
                        style={{ width: 100, textAlign: 'right' }}
                        value={shopifyPlanCredits[plan]}
                        disabled={saving}
                        onChange={(e) =>
                          setShopifyPlanCredits((prev) => ({
                            ...prev,
                            [plan]: Number(e.target.value),
                          }))
                        }
                      />
                      <span
                        style={{ fontSize: 13, color: 'var(--muted)', whiteSpace: 'nowrap' }}
                      >
                        credits / cycle
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="setting-actions">
              <button
                className="btn primary"
                onClick={save}
                disabled={
                  saving ||
                  !Number.isInteger(shopifyTrialCredits) ||
                  shopifyTrialCredits < 0 ||
                  shopifyTrialCredits > 1000 ||
                  !Number.isInteger(shopifyPlanCredits.starter) ||
                  shopifyPlanCredits.starter < 1 ||
                  shopifyPlanCredits.starter > 1000000 ||
                  !Number.isInteger(shopifyPlanCredits.growth) ||
                  shopifyPlanCredits.growth < 1 ||
                  shopifyPlanCredits.growth > 1000000 ||
                  !Number.isInteger(shopifyPlanCredits.pro) ||
                  shopifyPlanCredits.pro < 1 ||
                  shopifyPlanCredits.pro > 1000000
                }
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
