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
import { AppFont } from '../components/AppFont';
import { ErrorBanner } from '../components/ErrorBanner';
import { AskForEmailCard, PerShopperLimitCard } from '../components/ShopperLimitCards';
import { apiFetch } from '../lib/api';
import { type ClassifiedError, classifyError } from '../lib/errors';
import {
  numericLimitPatch,
  numericOptions,
  OFF,
  PRESELECTED,
  STORE_DAILY_CAP_OPTIONS,
} from '../lib/limits';
import type { ShopifyMe, ShopifyStoreLimits, ShopifyStoreRetention } from '../types';

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
  ];

  return (
    <AppFont>
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
                      generating until tomorrow — no matter who is asking. This is the only limit
                      that cannot be worked around from a browser.
                    </Text>
                    <Select
                      label="Try-ons per day"
                      options={numericOptions(
                        STORE_DAILY_CAP_OPTIONS,
                        'No limit',
                        (n) => `${n} per day`,
                      )}
                      value={limits.storeDailyCap == null ? OFF : String(limits.storeDailyCap)}
                      onChange={(v) =>
                        patchLimits(
                          numericLimitPatch('storeDailyCap', v, PRESELECTED.storeDailyCap),
                        )
                      }
                    />
                  </BlockStack>
                </Card>

                <PerShopperLimitCard limits={limits} onChange={patchLimits} />

                <AskForEmailCard limits={limits} onChange={patchLimits} />

                <InlineStack align="end">
                  <Button variant="primary" size="large" loading={saving} onClick={save}>
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
                    servers and you're responsible for how long that lasts. This schedule deletes
                    them automatically — useful for your own privacy policy — while try-on records
                    used for billing are always kept. Deleting shopper records also resets their
                    limits, so set that window longer than your per-shopper cap.
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
                  <InlineStack align="end">
                    <Button variant="primary" size="large" loading={saving} onClick={save}>
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
    </AppFont>
  );
}
