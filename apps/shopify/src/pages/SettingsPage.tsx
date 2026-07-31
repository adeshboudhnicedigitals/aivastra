import {
  Banner,
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
import { apiFetch } from '../lib/api';
import type { ShopifyMe, ShopifyStoreLimits } from '../types';

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

export default function SettingsPage() {
  const [selectedTab, setSelectedTab] = useState(0);
  const [limits, setLimits] = useState<ShopifyStoreLimits>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch<ShopifyMe>('/v1/shopify/me')
      .then((res) => {
        setLimits(res.store.settings.limits ?? {});
        setLoading(false);
      })
      .catch((err) => {
        setError((err as Error).message);
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
        body: JSON.stringify({ limits }),
      });
      setToastMessage('Limits saved.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function setNumeric(key: keyof ShopifyStoreLimits, raw: string, preselected: number) {
    setLimits((prev) => ({
      ...prev,
      [key]: raw === OFF ? null : Number(raw) || preselected,
    }));
  }

  if (loading) return <SkeletonPage title="Settings" />;

  const tabs = [
    { id: 'limits', content: 'Limits' },
    { id: 'data', content: 'Data' },
  ];

  return (
    <Page title="Settings">
      <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
        <BlockStack gap="400">
          {error && (
            <Banner tone="critical" onDismiss={() => setError(null)}>
              {error}
            </Banner>
          )}

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
                    Collected addresses appear under the Data tab.
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
              <Text as="p" tone="subdued">
                Retention and collected emails appear here.
              </Text>
            </Card>
          )}
        </BlockStack>
      </Tabs>

      {toastMessage && <Toast content={toastMessage} onDismiss={() => setToastMessage(null)} />}
    </Page>
  );
}
