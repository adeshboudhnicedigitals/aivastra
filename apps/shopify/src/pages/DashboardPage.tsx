import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  InlineStack,
  Layout,
  Page,
  SkeletonBodyText,
  Text,
} from '@shopify/polaris';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { STATUS_DOT_COLOR } from '../lib/statusColors';
import type { ShopifyMe, ShopifyOnboardingConfirmResponse } from '../types';

function StatusDotRow({
  label,
  count,
  dotColor,
}: {
  label: string;
  count: number;
  dotColor: string;
}) {
  return (
    <InlineStack align="space-between">
      <InlineStack gap="200" blockAlign="center">
        <span
          style={{
            display: 'inline-block',
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: dotColor,
          }}
        />
        <Text as="p">{label}</Text>
      </InlineStack>
      <Text as="p" fontWeight="semibold">
        {count}
      </Text>
    </InlineStack>
  );
}

export default function DashboardPage() {
  const [me, setMe] = useState<ShopifyMe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const navigate = useNavigate();

  const load = useCallback(() => {
    setLoading(true);
    apiFetch<ShopifyMe>('/v1/shopify/me')
      .then(setMe)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function syncProducts() {
    setSyncing(true);
    setError(null);
    try {
      await apiFetch('/v1/shopify/products/sync', { method: 'POST' });
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSyncing(false);
    }
  }

  async function confirmThemeBlock() {
    setConfirming(true);
    setError(null);
    try {
      const { settings } = await apiFetch<ShopifyOnboardingConfirmResponse>(
        '/v1/shopify/onboarding/confirm-theme-block',
        { method: 'POST' },
      );
      setMe((prev) => (prev ? { ...prev, store: { ...prev.store, settings } } : prev));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setConfirming(false);
    }
  }

  if (loading) {
    return (
      <Page title="Home">
        <Layout>
          <Layout.Section>
            <Card>
              <SkeletonBodyText lines={6} />
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  const synced = (me?.stats.syncedProductCount ?? 0) > 0;
  const enabled = (me?.stats.enabledProductCount ?? 0) > 0;
  const themeBlockDone = me?.store.settings.themeBlockConfirmed ?? false;
  const funnelConfigured = me?.stats.funnelConfigured ?? false;
  const doneCount = [synced, enabled, themeBlockDone, funnelConfigured].filter(Boolean).length;

  return (
    <Page title="Home" subtitle={me?.store.shopDomain}>
      <Layout>
        <Layout.Section>
          {error && (
            <Banner tone="critical" title="Something went wrong">
              {error}
            </Banner>
          )}

          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingMd">
                  Getting Started
                </Text>
                <Badge tone={doneCount === 4 ? 'success' : 'info'}>{`${doneCount}/4`}</Badge>
              </InlineStack>

              <InlineStack align="space-between">
                <Text as="p">{synced ? '✅' : '⭕'} Sync your products</Text>
                <Button
                  onClick={syncProducts}
                  loading={syncing}
                  disabled={synced}
                  variant="primary"
                >
                  Sync products now
                </Button>
              </InlineStack>

              <InlineStack align="space-between">
                <Text as="p">{enabled ? '✅' : '⭕'} Enable try-on on a product</Text>
                <Button onClick={() => navigate('/products')}>Go to Products</Button>
              </InlineStack>

              <InlineStack align="space-between">
                <Text as="p">
                  {themeBlockDone ? '✅' : '⭕'} Add the Try It On block to your theme
                </Text>
                {!themeBlockDone && (
                  <Button onClick={confirmThemeBlock} loading={confirming}>
                    I've added it
                  </Button>
                )}
              </InlineStack>

              <InlineStack align="space-between">
                <Text as="p">{funnelConfigured ? '✅' : '⭕'} Set up your funnel templates</Text>
                <Button onClick={() => navigate('/funnel-setup')}>Go to Funnel Setup</Button>
              </InlineStack>
            </BlockStack>
          </Card>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '16px',
              marginTop: '16px',
              marginBottom: '16px',
            }}
          >
            <Card>
              <Text as="h3" variant="headingSm">
                Try-Ons
              </Text>
              <Text as="p" variant="heading2xl">
                {me?.stats.totalTryOns ?? 0}
              </Text>
            </Card>
            <Card>
              <Text as="h3" variant="headingSm">
                Products Synced
              </Text>
              <Text as="p" variant="heading2xl">
                {me?.stats.syncedProductCount ?? 0}
              </Text>
            </Card>
            <Card>
              <Text as="h3" variant="headingSm">
                Products Enabled
              </Text>
              <Text as="p" variant="heading2xl">
                {me?.stats.enabledProductCount ?? 0}
              </Text>
            </Card>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1.1fr 1fr',
              gap: '16px',
              marginTop: '16px',
              marginBottom: '16px',
            }}
          >
            <div
              style={{
                position: 'relative',
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  height: '3px',
                  background:
                    'linear-gradient(90deg, var(--p-color-bg-fill-brand), var(--p-color-bg-fill-brand-hover))',
                  borderTopLeftRadius: 'var(--p-border-radius-300)',
                  borderTopRightRadius: 'var(--p-border-radius-300)',
                  zIndex: 1,
                }}
              />
              <div style={{ flex: 1, display: 'grid' }}>
                <Card>
                  <BlockStack gap="200">
                    <Text as="h3" variant="headingSm">
                      Credit Balance
                    </Text>
                    <Text as="p" variant="heading2xl">
                      {me?.creditBalance ?? 0}
                    </Text>
                  </BlockStack>
                  <div
                    style={{ position: 'absolute', bottom: '16px', left: '16px', right: '16px' }}
                  >
                    <Button
                      variant="primary"
                      fullWidth
                      onClick={() =>
                        window.open('https://app.aivastra.com/pricing', '_blank', 'noopener')
                      }
                    >
                      Top up on aivastra.com
                    </Button>
                  </div>
                </Card>
              </div>
            </div>

            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">
                  Product sync status
                </Text>
                <StatusDotRow
                  label="Active"
                  count={me?.stats.statusCounts.active ?? 0}
                  dotColor={STATUS_DOT_COLOR.active}
                />
                <StatusDotRow
                  label="Processing"
                  count={me?.stats.statusCounts.processing ?? 0}
                  dotColor={STATUS_DOT_COLOR.processing}
                />
                <StatusDotRow
                  label="Failed"
                  count={me?.stats.statusCounts.failed ?? 0}
                  dotColor={STATUS_DOT_COLOR.failed}
                />
                <StatusDotRow
                  label="Disabled"
                  count={me?.stats.statusCounts.disabled ?? 0}
                  dotColor={STATUS_DOT_COLOR.disabled}
                />
              </BlockStack>
            </Card>
          </div>

          <Card>
            <InlineStack align="space-between">
              <Button onClick={() => navigate('/products')}>Manage Products</Button>
              {me?.store.connectedSince && (
                <Text as="p" tone="subdued">
                  Connected since {new Date(me.store.connectedSince).toLocaleDateString()}
                </Text>
              )}
            </InlineStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
