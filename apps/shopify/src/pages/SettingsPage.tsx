import { BlockStack, Select, SkeletonPage, Toast } from '@shopify/polaris';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { AppFont } from '../components/AppFont';
import { AppPage } from '../components/AppPage';
import { AvCard } from '../components/AvCard';
import { ErrorBanner } from '../components/ErrorBanner';
import { Glyph } from '../components/PageHead';
import { PillTabs } from '../components/PillTabs';
import { apiFetch } from '../lib/api';
import { type ClassifiedError, classifyError } from '../lib/errors';
import {
  EMAIL_AFTER_N_OPTIONS,
  loginRequiredPatch,
  numericLimitPatch,
  numericOptions,
  OFF,
  PER_SHOPPER_CAP_OPTIONS,
  PRESELECTED,
  STORE_DAILY_CAP_OPTIONS,
} from '../lib/limits';
import type { ShopifyMe, ShopifyStoreLimits, ShopifyStoreRetention } from '../types';

// One row of a settings panel: label and explanation on the left, control on the right.
function SettingRow({
  title,
  description,
  dim = false,
  children,
}: {
  title: string;
  description: string;
  dim?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="av-row">
      <div style={dim ? { opacity: 0.55 } : undefined}>
        <h2 className="av-rt">{title}</h2>
        <p className="av-rd">{description}</p>
      </div>
      <div className="av-selw">{children}</div>
    </div>
  );
}

function SaveBar({ saving, onSave }: { saving: boolean; onSave: () => void }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
      <button
        type="button"
        className="av-btn-primary"
        onClick={onSave}
        disabled={saving}
        aria-busy={saving || undefined}
      >
        Save
      </button>
    </div>
  );
}

export default function SettingsPage() {
  const [selectedTab, setSelectedTab] = useState(0);
  const [limits, setLimits] = useState<ShopifyStoreLimits>({});
  const [retention, setRetention] = useState<ShopifyStoreRetention>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ClassifiedError | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [openingEditor, setOpeningEditor] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch<ShopifyMe>('/v1/shopify/me')
      .then((res) => {
        setLimits(res.store.settings.limits ?? {});
        setRetention(res.store.settings.retention ?? {});
        setLoading(false);
      })
      .catch((err) => {
        setError(classifyError(err));
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await apiFetch('/v1/shopify/settings', {
        method: 'PATCH',
        body: JSON.stringify({ limits, retention }),
      });
      setToastMessage('Limits saved.');
    } catch (err) {
      setError(classifyError(err));
    } finally {
      setSaving(false);
    }
  }

  // Opens the product template with the Try It On app block staged. The
  // merchant drags it into place and presses Save in the theme editor.
  async function openBlockEditor() {
    if (openingEditor) return;
    setOpeningEditor(true);
    setError(null);
    try {
      const { url } = await apiFetch<{ url: string }>('/v1/shopify/theme-block-url');
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      setError(classifyError(err));
    } finally {
      setOpeningEditor(false);
    }
  }

  const patchLimits = (patch: Partial<ShopifyStoreLimits>) =>
    setLimits((prev) => ({ ...prev, ...patch }));

  if (loading) {
    return (
      <AppFont>
        <SkeletonPage title="Settings" />
      </AppFont>
    );
  }

  const tabs = [
    { id: 'limits', content: 'Limits' },
    { id: 'privacy', content: 'Privacy' },
    { id: 'placement', content: 'Button placement' },
  ];

  return (
    <AppFont>
      <AppPage
        title="Settings"
        actions={
          <PillTabs
            boxed
            label="Settings sections"
            tabs={tabs}
            selected={selectedTab}
            onSelect={setSelectedTab}
          />
        }
      >
        <BlockStack gap="400">
          <ErrorBanner error={error} onRetry={load} onDismiss={() => setError(null)} />

          {selectedTab === 0 && (
            <>
              <div className="av-panel">
                <SettingRow
                  title="Store daily limit"
                  description="The hard ceiling. Once this many try-ons have run today, the widget stops generating until tomorrow, no matter who is asking. This is the only limit that cannot be worked around from a browser."
                >
                  <Select
                    label="Try-ons per day"
                    labelHidden
                    options={numericOptions(
                      STORE_DAILY_CAP_OPTIONS,
                      'No limit',
                      (n) => `${n} per day`,
                    )}
                    value={limits.storeDailyCap == null ? OFF : String(limits.storeDailyCap)}
                    onChange={(v) =>
                      patchLimits(numericLimitPatch('storeDailyCap', v, PRESELECTED.storeDailyCap))
                    }
                  />
                </SettingRow>
                <SettingRow
                  title="Try-ons per shopper"
                  description="Limits try-ons per user. It is friction, not a hard spend cap."
                >
                  <Select
                    label="Try-ons per shopper"
                    labelHidden
                    options={numericOptions(PER_SHOPPER_CAP_OPTIONS, 'No limit', (n) => String(n))}
                    value={limits.perShopperCap == null ? OFF : String(limits.perShopperCap)}
                    onChange={(v) =>
                      patchLimits(numericLimitPatch('perShopperCap', v, PRESELECTED.perShopperCap))
                    }
                  />
                </SettingRow>
                <SettingRow
                  title="Resets every"
                  description="How often each shopper's try-on count starts again."
                  dim={limits.perShopperCap == null}
                >
                  <Select
                    label="Resets every"
                    labelHidden
                    options={[
                      { label: 'Day', value: 'day' },
                      { label: 'Week', value: 'week' },
                      { label: 'Month', value: 'month' },
                    ]}
                    value={limits.perShopperWindow ?? 'week'}
                    onChange={(v) =>
                      patchLimits({ perShopperWindow: v as 'day' | 'week' | 'month' })
                    }
                    disabled={limits.perShopperCap == null}
                  />
                </SettingRow>
                <SettingRow
                  title="Require login"
                  description="Shoppers must log in to use try-on. Email and phone number are collected automatically: from the customer account when present, otherwise the shopper is asked."
                >
                  <button
                    type="button"
                    className="av-sw"
                    role="switch"
                    aria-checked={limits.loginRequired === true}
                    aria-label="Shoppers must log in to use try-on"
                    onClick={() => patchLimits(loginRequiredPatch(limits.loginRequired !== true))}
                  >
                    <span />
                  </button>
                </SettingRow>
                <SettingRow
                  title="Ask for an email"
                  description="Asks users for their email after this many try-ons."
                >
                  <Select
                    label="Ask after"
                    labelHidden
                    options={numericOptions(EMAIL_AFTER_N_OPTIONS, 'Never ask', (n) =>
                      n === 0 ? 'Before the first try-on' : `${n} try-on${n === 1 ? '' : 's'}`,
                    )}
                    value={
                      limits.emailAfterNTryOns == null ? OFF : String(limits.emailAfterNTryOns)
                    }
                    onChange={(v) =>
                      patchLimits(
                        numericLimitPatch('emailAfterNTryOns', v, PRESELECTED.emailAfterNTryOns),
                      )
                    }
                  />
                </SettingRow>
              </div>
              <SaveBar saving={saving} onSave={save} />
            </>
          )}

          {selectedTab === 1 && (
            <>
              <p className="av-sub" style={{ margin: 0, maxWidth: 900 }}>
                Neither of us can view a shopper's photo or result, but they're stored on our
                servers and you're responsible for how long that lasts. This schedule deletes them
                automatically, useful for your own privacy policy, while try-on records used for
                billing are always kept. Deleting shopper records also resets their limits, so set
                that window longer than your per-shopper cap.
              </p>
              <div className="av-panel">
                <SettingRow
                  title="Shopper photos"
                  description="Delete the photos shoppers upload after this long."
                >
                  <Select
                    label="Delete shopper photos after"
                    labelHidden
                    options={numericOptions([7, 30, 90], 'Keep forever', (n) => `${n} days`)}
                    value={
                      retention.shopperPhotoDays == null ? OFF : String(retention.shopperPhotoDays)
                    }
                    onChange={(v) =>
                      setRetention((p) => ({
                        ...p,
                        shopperPhotoDays: v === OFF ? null : Number(v),
                      }))
                    }
                  />
                </SettingRow>
                <SettingRow
                  title="Generated images"
                  description="Delete the try-on results after this long."
                >
                  <Select
                    label="Delete generated images after"
                    labelHidden
                    options={numericOptions([30, 90, 180, 365], 'Keep forever', (n) => `${n} days`)}
                    value={retention.resultDays == null ? OFF : String(retention.resultDays)}
                    onChange={(v) =>
                      setRetention((p) => ({ ...p, resultDays: v === OFF ? null : Number(v) }))
                    }
                  />
                </SettingRow>
                <SettingRow
                  title="Shopper records"
                  description="Delete collected contact details and counts after this long."
                >
                  <Select
                    label="Delete shopper records after"
                    labelHidden
                    options={numericOptions([90, 180, 365], 'Keep forever', (n) => `${n} days`)}
                    value={
                      retention.shopperRecordDays == null
                        ? OFF
                        : String(retention.shopperRecordDays)
                    }
                    onChange={(v) =>
                      setRetention((p) => ({
                        ...p,
                        shopperRecordDays: v === OFF ? null : Number(v),
                      }))
                    }
                  />
                </SettingRow>
              </div>
              <SaveBar saving={saving} onSave={save} />
            </>
          )}

          {selectedTab === 2 && (
            <AvCard>
              <div className="av-place">
                <div>
                  <div className="av-place-head">
                    <span className="av-tile" style={{ width: 52, height: 52, borderRadius: 16 }}>
                      <Glyph size={26}>
                        <rect x="3" y="4" width="18" height="16" rx="3" />
                        <path d="M7 15h10" />
                        <path d="M7 10h4" />
                      </Glyph>
                    </span>
                    <h2 className="av-h2">Choose where the button goes</h2>
                  </div>
                  <p className="av-sub" style={{ fontSize: 16, maxWidth: 560 }}>
                    The Try It On button is an app block: add it to your product page and drag it
                    where you want it. The Try It On app embed adds a small icon on your product
                    photos that opens the same try-on window.
                  </p>
                  <button
                    type="button"
                    className="av-btn-primary"
                    style={{ marginTop: 20 }}
                    onClick={openBlockEditor}
                    disabled={openingEditor}
                    aria-busy={openingEditor || undefined}
                  >
                    Add the button block
                    <Glyph size={20}>
                      <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
                    </Glyph>
                  </button>
                </div>
                <div className="av-place-preview" aria-hidden>
                  <div className="av-place-line" style={{ width: '45%' }} />
                  <div className="av-place-line" style={{ width: '30%' }} />
                  <div className="av-place-btn off">Add to cart</div>
                  <div className="av-place-btn">Buy it now</div>
                  <div className="av-place-btn on">Try It On</div>
                </div>
              </div>
            </AvCard>
          )}
        </BlockStack>

        {toastMessage && <Toast content={toastMessage} onDismiss={() => setToastMessage(null)} />}
      </AppPage>
    </AppFont>
  );
}
