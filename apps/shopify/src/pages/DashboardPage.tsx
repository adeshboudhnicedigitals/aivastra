import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  InlineGrid,
  InlineStack,
  Modal,
  Page,
  ProgressBar,
  SkeletonBodyText,
  SkeletonPage,
  Text,
  Toast,
} from '@shopify/polaris';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import type { ShopifyMe, ShopifyOnboardingConfirmResponse, ShopifyStats } from '../types';

type StatusKey = keyof ShopifyStats['statusCounts'];

const STATUS_TONE: Record<StatusKey, 'success' | 'attention' | 'critical' | 'info'> = {
  active: 'success',
  processing: 'attention',
  failed: 'critical',
  disabled: 'info',
};

const STATUS_LABEL: Record<StatusKey, string> = {
  active: 'Active',
  processing: 'Processing',
  failed: 'Failed',
  disabled: 'Disabled',
};

function StepRow({
  done,
  title,
  description,
  children,
}: {
  done: boolean;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Box paddingBlockEnd="400" borderBlockEndWidth="025" borderColor="border">
      <BlockStack gap="200">
        <InlineStack align="space-between" blockAlign="start" gap="200">
          <InlineStack gap="200" blockAlign="center">
            <Badge tone={done ? 'success' : undefined}>{done ? 'Done' : 'To do'}</Badge>
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              {title}
            </Text>
          </InlineStack>
          <InlineStack gap="200">{children}</InlineStack>
        </InlineStack>
        <Text as="p" tone="subdued">
          {description}
        </Text>
      </BlockStack>
    </Box>
  );
}

export default function DashboardPage() {
  const [me, setMe] = useState<ShopifyMe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [openingEditor, setOpeningEditor] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [showDisconnect, setShowDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
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
      setToastMessage('Products synced from Shopify.');
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSyncing(false);
    }
  }

  async function openThemeEditor() {
    setOpeningEditor(true);
    setError(null);
    try {
      const { url } = await apiFetch<{ url: string }>('/v1/shopify/onboarding/theme-editor-url');
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setOpeningEditor(false);
    }
  }

  async function disconnectAccount() {
    setDisconnecting(true);
    setError(null);
    try {
      await apiFetch('/v1/shopify/store/account/unlink', { method: 'POST' });
      // Full reload so App.tsx re-fetches /v1/shopify/me from scratch and
      // re-gates to LinkAccountGate now that ownerUserId is cleared server-side.
      window.location.reload();
    } catch (err) {
      setError((err as Error).message);
      setDisconnecting(false);
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
      setToastMessage('Got it — Try It On block confirmed.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setConfirming(false);
    }
  }

  if (loading) {
    return (
      <SkeletonPage primaryAction>
        <SkeletonBodyText />
      </SkeletonPage>
    );
  }

  const synced = (me?.stats.syncedProductCount ?? 0) > 0;
  const enabled = (me?.stats.enabledProductCount ?? 0) > 0;
  const themeBlockDone = me?.store.settings.themeBlockConfirmed ?? false;
  const doneCount = [synced, enabled, themeBlockDone].filter(Boolean).length;
  const allDone = doneCount === 3;
  const collapsed = allDone && !expanded;

  return (
    <Page title="Dashboard" subtitle="Here's how virtual try-on is performing on your store.">
      <BlockStack gap="400">
        {error && <Banner tone="critical">{error}</Banner>}

        <Card>
          <BlockStack gap="400">
            <ProgressBar progress={(doneCount / 3) * 100} size="small" />
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                Getting started ({doneCount}/3)
              </Text>
              <Button variant="plain" onClick={() => setExpanded((v) => !v)}>
                {collapsed ? 'Show steps' : 'Hide steps'}
              </Button>
            </InlineStack>

            {collapsed ? (
              <Text as="p" tone="success">
                All set — virtual try-on is live on your store.
              </Text>
            ) : (
              <BlockStack gap="400">
                <StepRow
                  done={synced}
                  title="Sync your products"
                  description="Import your Shopify catalog so AiVastra can generate try-on images."
                >
                  <Button variant="primary" onClick={syncProducts} loading={syncing}>
                    Sync products now
                  </Button>
                </StepRow>
                <StepRow
                  done={enabled}
                  title="Enable try-on on a product"
                  description="Turn on virtual try-on for at least one product."
                >
                  <Button variant="primary" onClick={() => navigate('/manage')}>
                    Go to Manage
                  </Button>
                </StepRow>
                <StepRow
                  done={themeBlockDone}
                  title="Add the Try It On block to your product page"
                  description="Required — the try-on button only appears where you place this block. Open the theme editor, then save."
                >
                  <Button onClick={openThemeEditor} loading={openingEditor}>
                    Open theme editor
                  </Button>
                  <Button variant="primary" onClick={confirmThemeBlock} loading={confirming}>
                    I've added it
                  </Button>
                </StepRow>
              </BlockStack>
            )}
          </BlockStack>
        </Card>

        <InlineGrid columns={{ xs: 1, sm: 3 }} gap="400">
          <Card>
            <BlockStack gap="200">
              <Text as="p" tone="subdued">
                Try-Ons
              </Text>
              <Text as="p" variant="heading2xl">
                {me?.stats.totalTryOns ?? 0}
              </Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="200">
              <Text as="p" tone="subdued">
                Products Synced
              </Text>
              <Text as="p" variant="heading2xl">
                {me?.stats.syncedProductCount ?? 0}
              </Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="200">
              <Text as="p" tone="subdued">
                Try-On Enabled
              </Text>
              <Text as="p" variant="heading2xl">
                {me?.stats.enabledProductCount ?? 0}
              </Text>
              <Text as="p" tone="subdued">
                of {me?.stats.syncedProductCount ?? 0} synced
              </Text>
            </BlockStack>
          </Card>
        </InlineGrid>

        <InlineGrid columns={{ xs: 1, sm: 3 }} gap="400">
          <Card>
            <BlockStack gap="300">
              <Text as="p" tone="subdued">
                Credit balance
              </Text>
              <Text as="p" variant="heading2xl">
                {me?.creditBalance ?? 0}
              </Text>
              <Box>
                <Button url="https://app.aivastra.com/pricing" target="_blank">
                  Top up on aivastra.com
                </Button>
              </Box>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">
                Today's try-ons
              </Text>
              <Text as="p" variant="heading2xl">
                {me?.stats.storeDailyCap
                  ? `${me.stats.todayTryOns} / ${me.stats.storeDailyCap}`
                  : (me?.stats.todayTryOns ?? 0)}
              </Text>
              {me?.stats.storeDailyCap != null &&
                me.stats.todayTryOns >= me.stats.storeDailyCap && (
                  <Banner tone="warning">
                    Your daily limit is reached. Try-on is paused until tomorrow.
                  </Banner>
                )}
              <Text as="p" tone="subdued">
                {me?.stats.capturedEmailCount ?? 0} emails collected
              </Text>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="300">
              <Text as="p" tone="subdued">
                Sync status
              </Text>
              {(['active', 'processing', 'failed', 'disabled'] as const).map((key) => (
                <InlineStack key={key} align="space-between" blockAlign="center">
                  <Text as="span">{STATUS_LABEL[key]}</Text>
                  <Badge tone={STATUS_TONE[key]}>{String(me?.stats.statusCounts[key] ?? 0)}</Badge>
                </InlineStack>
              ))}
            </BlockStack>
          </Card>
        </InlineGrid>

        <InlineStack align="space-between" blockAlign="center">
          <Button variant="plain" onClick={() => navigate('/manage')}>
            Manage Products
          </Button>
          <InlineStack gap="400" blockAlign="center">
            {me?.store.connectedSince && (
              <Text as="span" tone="subdued">
                Connected since {new Date(me.store.connectedSince).toLocaleDateString()}
              </Text>
            )}
            <Button variant="plain" tone="critical" onClick={() => setShowDisconnect(true)}>
              Disconnect account
            </Button>
          </InlineStack>
        </InlineStack>
      </BlockStack>

      <Modal
        open={showDisconnect}
        onClose={() => setShowDisconnect(false)}
        title="Disconnect AiVastra?"
        primaryAction={{
          content: 'Disconnect',
          destructive: true,
          loading: disconnecting,
          onAction: disconnectAccount,
        }}
        secondaryActions={[{ content: 'Cancel', onAction: () => setShowDisconnect(false) }]}
      >
        <Modal.Section>
          <Text as="p">
            Shoppers will stop seeing the Try It On button on your storefront until you reconnect.
            Your AiVastra account, credits, and history stay safe at app.aivastra.com.
          </Text>
        </Modal.Section>
      </Modal>

      {toastMessage && <Toast content={toastMessage} onDismiss={() => setToastMessage(null)} />}
    </Page>
  );
}
