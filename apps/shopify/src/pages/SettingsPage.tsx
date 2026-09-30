import {
  BlockStack,
  Button,
  Card,
  InlineStack,
  Page,
  Select,
  SkeletonPage,
  Tabs,
  Text,
  Toast,
} from '@shopify/polaris';
import { useCallback, useEffect, useState } from 'react';
import { ErrorBanner } from '../components/ErrorBanner';
import { apiFetch } from '../lib/api';
import { type ClassifiedError, classifyError } from '../lib/errors';
import type { ShopifyMe, ShopifyStoreLimits, ShopifyStoreRetention } from '../types';

const OFF = 'off';

// Mirrors the option sets in packages/types/src/widget.ts. Values outside these
// sets are rejected by the API with a 400.
const STORE_DAILY_CAP_OPTIONS = [50, 100, 250, 500, 1000, 2500, 5000];
const PER_SHOPPER_CAP_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const EMAIL_AFTER_N_OPTIONS = [0, 1, 2, 3, 5];

// The value the dropdown SHOWS when a merchant switches a limit on. It is not
// an enforced default: an absent setting means Off, so nothing changes for a
// store whose merchant never opens this page.
const PRESELECTED = { storeDailyCap: 250, perShopperCap: 5, emailAfterNTryOns: 2 };

function numericOptions(values: number[], offLabel: string, format: (n: number) => string) {
  return [
    { label: offLabel, value: OFF },
    ...values.map((n) => ({ label: format(n), value: String(n) })),
  ];
}

/**
 * Parse a Select option value into the numeric limit to persist.
 *
 * `Number.isFinite` rather than a `||` fallback: `0` is a legitimate option
 * ("Before the first try-on") and is falsy, so `Number(raw) || preselected`
 * silently replaced it with the preselected value.
 */
export function resolveNumericLimit(raw: string, preselected: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : preselected;
}

export default function SettingsPage() {
  const [selectedTab, setSelectedTab] = useState(0);
  const [limits, setLimits] = useState<ShopifyStoreLimits>({});
  const [retention, setRetention] = useState<ShopifyStoreRetention>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ClassifiedError | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

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

  /**
   * Resolve a Select value into the numeric limit to store.
   *
   * Pure and exported so the `0` case stays pinned by the comment below: `0` is
   * a real, selectable option ("Before the first try-on"), and a `||` fallback
   * would silently discard it because `0` is falsy — a merchant asking for the
   * email gate up front would have been saved as "after 2 try-ons" instead.
   * `preselected` is only the parse-failure fallback, which should never fire
   * since `raw` always comes from one of the rendered option values.
   */
  function setNumeric(key: keyof ShopifyStoreLimits, raw: string, preselected: number) {
    setLimits((prev) => ({
      ...prev,
      [key]: raw === OFF ? null : resolveNumericLimit(raw, preselected),
    }));
  }

  if (loading) return <SkeletonPage title="Settings" />;

  const tabs = [
    { id: 'limits', content: 'Limits' },
    { id: 'privacy', content: 'Privacy' },
  ];

  return (
    <Page title="Settings">
      <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
        <BlockStack gap="400">
          <ErrorBanner error={error} onRetry={load} onDismiss={() => setError(null)} />

          {selectedTab === 0 && (
            <>
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    Store daily limit
                  </Text>
                  <Text as="p" tone="subdued">
                    The hard ceiling. Once this many try-ons have run today, the widget stops
                    generating until tomorrow — no matter who is asking. This is the only limit that
                    cannot be worked around from a browser.
                  </Text>
                  <Select
                    label="Try-ons per day"
                    options={numericOptions(
                      STORE_DAILY_CAP_OPTIONS,
                      'No limit',
                      (n) => `${n} per day`,
                    )}
                    value={limits.storeDailyCap == null ? OFF : String(limits.storeDailyCap)}
                    onChange={(v) => setNumeric('storeDailyCap', v, PRESELECTED.storeDailyCap)}
                  />
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    Per-shopper limit
                  </Text>
                  <Text as="p" tone="subdued">
                    Reduces casual overuse by one shopper. Treat it as friction, not as a spend
                    guarantee — a shopper who clears their browser storage gets a fresh allowance.
                    Set a store daily limit as well if you want a hard ceiling.
                  </Text>
                  <Select
                    label="Try-ons per shopper"
                    options={numericOptions(PER_SHOPPER_CAP_OPTIONS, 'No limit', (n) => String(n))}
                    value={limits.perShopperCap == null ? OFF : String(limits.perShopperCap)}
                    onChange={(v) => setNumeric('perShopperCap', v, PRESELECTED.perShopperCap)}
                  />
                  <Select
                    label="Resets every"
                    options={[
                      { label: 'Day', value: 'day' },
                      { label: 'Week', value: 'week' },
                      { label: 'Month', value: 'month' },
                    ]}
                    value={limits.perShopperWindow ?? 'week'}
                    onChange={(v) =>
                      setLimits((prev) => ({
                        ...prev,
                        perShopperWindow: v as 'day' | 'week' | 'month',
                      }))
                    }
                    disabled={limits.perShopperCap == null}
                  />
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    Ask for an email
                  </Text>
                  <Text as="p" tone="subdued">
                    After this many try-ons, shoppers are asked for their email before continuing.
                    Collected addresses appear on the Analytics page.
                  </Text>
                  <Select
                    label="Ask after"
                    options={numericOptions(EMAIL_AFTER_N_OPTIONS, 'Never ask', (n) =>
                      n === 0 ? 'Before the first try-on' : `${n} try-on${n === 1 ? '' : 's'}`,
                    )}
                    value={
                      limits.emailAfterNTryOns == null ? OFF : String(limits.emailAfterNTryOns)
                    }
                    onChange={(v) =>
                      setNumeric('emailAfterNTryOns', v, PRESELECTED.emailAfterNTryOns)
                    }
                  />
                </BlockStack>
              </Card>

              <InlineStack align="end">
                <Button variant="primary" loading={saving} onClick={save}>
                  Save
                </Button>
              </InlineStack>
            </>
          )}

          {selectedTab === 1 && (
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Automatic deletion
                </Text>
                <Text as="p" tone="subdued">
                  Neither of us can view a shopper's photo or result, but they're stored on our
                  servers and you're responsible for how long that lasts. This schedule deletes them
                  automatically — useful for your own privacy policy — while try-on records used for
                  billing are always kept. Deleting shopper records also resets their limits, so set
                  that window longer than your per-shopper cap.
                </Text>
                <Select
                  label="Delete shopper photos after"
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
                <Select
                  label="Delete generated images after"
                  options={numericOptions([30, 90, 180, 365], 'Keep forever', (n) => `${n} days`)}
                  value={retention.resultDays == null ? OFF : String(retention.resultDays)}
                  onChange={(v) =>
                    setRetention((p) => ({ ...p, resultDays: v === OFF ? null : Number(v) }))
                  }
                />
                <Select
                  label="Delete shopper records after"
                  options={numericOptions([90, 180, 365], 'Keep forever', (n) => `${n} days`)}
                  value={
                    retention.shopperRecordDays == null ? OFF : String(retention.shopperRecordDays)
                  }
                  onChange={(v) =>
                    setRetention((p) => ({
                      ...p,
                      shopperRecordDays: v === OFF ? null : Number(v),
                    }))
                  }
                />
                <InlineStack align="end">
                  <Button variant="primary" loading={saving} onClick={save}>
                    Save
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          )}
        </BlockStack>
      </Tabs>

      {toastMessage && <Toast content={toastMessage} onDismiss={() => setToastMessage(null)} />}
    </Page>
  );
}
