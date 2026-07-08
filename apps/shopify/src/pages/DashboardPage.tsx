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
import type { ShopifyMe, ShopifyOnboardingConfirmResponse } from '../types';

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
      <Page title="AiVastra Try-On">
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
  const doneCount = [synced, enabled, themeBlockDone].filter(Boolean).length;

  return (
    <Page title="AiVastra Try-On">
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
                <Badge tone={doneCount === 3 ? 'success' : 'info'}>{`${doneCount}/3`}</Badge>
              </InlineStack>

              <InlineStack align="space-between">
                <Text as="p">{synced ? '\u2705' : '\u2B55'} Sync your products</Text>
                <Button onClick={syncProducts} loading={syncing} disabled={synced}>
                  Sync products now
                </Button>
              </InlineStack>

              <InlineStack align="space-between">
                <Text as="p">{enabled ? '\u2705' : '\u2B55'} Enable try-on on a product</Text>
                <Button onClick={() => navigate('/products')}>Go to Products</Button>
              </InlineStack>

              <InlineStack align="space-between">
                <Text as="p">
                  {themeBlockDone ? '\u2705' : '\u2B55'} Add the Try It On block to your theme
                </Text>
                {!themeBlockDone && (
                  <Button onClick={confirmThemeBlock} loading={confirming}>
                    I've added it
                  </Button>
                )}
              </InlineStack>
            </BlockStack>
          </Card>

          <InlineStack gap="400">
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
          </InlineStack>

          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">
                {me?.store.shopDomain}
              </Text>
              <Text as="p">Credit balance: {me?.credits ?? 0}</Text>
              <InlineStack gap="200">
                <Button onClick={() => navigate('/products')}>Manage Products</Button>
                <Button onClick={() => navigate('/billing')}>Manage Billing</Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
