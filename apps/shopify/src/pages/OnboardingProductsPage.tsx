import { BlockStack, Button, Card, ProgressBar, Spinner, Text } from '@shopify/polaris';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ErrorBanner } from '../components/ErrorBanner';
import { OnboardingLayout } from '../components/OnboardingLayout';
import { apiFetch } from '../lib/api';
import { type ClassifiedError, classifyError } from '../lib/errors';
import { canShowProductsPage, getOnboardingStep, onboardingPath } from '../lib/onboarding';
import type { ShopifyMe, ShopifySyncStatus } from '../types';

const POLL_INTERVAL_MS = 1500;
const MAX_POLLS = 120;

export default function OnboardingProductsPage({
  me,
  onRefresh,
}: {
  me: ShopifyMe;
  onRefresh: () => Promise<ShopifyMe>;
}) {
  const navigate = useNavigate();
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState<{ imported: number; total: number | null }>({
    imported: 0,
    total: null,
  });
  const [error, setError] = useState<ClassifiedError | null>(null);
  const currentStep = getOnboardingStep(me);
  const syncStarted = useRef(false);
  const runSync = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      // Try-on starts on for every product. Only a store with no chosen mode is
      // set, so a mode picked earlier (or in Manage) is never overridden.
      if (!me.store.settings.activation?.mode) {
        await apiFetch('/v1/shopify/activation/mode', {
          method: 'PATCH',
          body: JSON.stringify({ mode: 'global' }),
        });
      }
      await apiFetch('/v1/shopify/products/sync', { method: 'POST' });
      let finished = false;
      for (let attempt = 0; attempt < MAX_POLLS && !finished; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        const status = await apiFetch<ShopifySyncStatus>('/v1/shopify/products/sync/status');
        setProgress({ imported: status.imported, total: status.total });
        finished = status.state === 'idle';
      }
      if (!finished)
        throw new Error('Importing your products is taking longer than expected. Try again.');
      await onRefresh();
    } catch (err) {
      setError(classifyError(err));
    } finally {
      setSyncing(false);
    }
  }, [onRefresh, me.store.settings.activation?.mode]);
  useEffect(() => {
    if (me.stats.syncedProductCount === 0 && !syncStarted.current) {
      syncStarted.current = true;
      void runSync();
    }
  }, [me.stats.syncedProductCount, runSync]);
  if (!canShowProductsPage(currentStep))
    return <Navigate to={onboardingPath(currentStep)} replace />;
  const imported = me.stats.syncedProductCount;
  const noProducts = !syncing && !error && syncStarted.current && imported === 0;
  const done = !syncing && imported > 0;
  // While syncing the live counts drive the bar; once finished (or on a revisit
  // with products already synced) every synced product is "done".
  const total = done ? imported : progress.total;
  const shown = done ? imported : Math.min(progress.imported, progress.total ?? progress.imported);
  const percent = done
    ? 100
    : total && total > 0
      ? Math.min(100, Math.round((shown / total) * 100))
      : 0;
  return (
    <OnboardingLayout
      bare
      page="products"
      continueDisabled={syncing || imported === 0}
      continueLoading={false}
      onContinue={() => navigate('/onboarding/contact')}
    >
      {/* Centred landscape panel (~16:9): the page is a single status message, so it
          sits in the middle of the panel instead of at the top of a tall column. */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '60vh',
          padding: 'var(--p-space-800)',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ width: '100%', maxWidth: 800 }}>
          <Card padding="800">
            <div
              style={{
                minHeight: 320,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                alignItems: 'center',
                textAlign: 'center',
                gap: 'var(--p-space-400)',
                aspectRatio: '16 / 9',
              }}
            >
              {error ? (
                <div style={{ width: '100%' }}>
                  <ErrorBanner
                    error={error}
                    onRetry={imported === 0 && !syncing ? runSync : undefined}
                    onDismiss={() => setError(null)}
                  />
                </div>
              ) : noProducts ? (
                <BlockStack gap="300" inlineAlign="center">
                  <Text as="h2" variant="headingXl">
                    No products found
                  </Text>
                  <Text as="p" tone="subdued">
                    We couldn&apos;t find any products in your store. Add products in Shopify, then
                    try again.
                  </Text>
                  <Button size="large" onClick={runSync}>
                    Import again
                  </Button>
                </BlockStack>
              ) : (
                <>
                  <Text as="h2" variant="headingXl">
                    {done ? 'Your Products Are Synced' : 'Your Products Are Syncing'}
                  </Text>
                  <BlockStack gap="100" inlineAlign="center">
                    <Text as="p" tone="subdued">
                      {done
                        ? 'Try-on is on for all of them. You can exclude products later in Manage.'
                        : 'Please wait while we sync your products from Shopify.'}
                    </Text>
                    {!done && (
                      <Text as="p" tone="subdued">
                        This may take a few moments.
                      </Text>
                    )}
                  </BlockStack>
                  <div style={{ width: '100%', maxWidth: 520 }}>
                    {total ? (
                      <ProgressBar progress={percent} size="small" />
                    ) : (
                      <Spinner accessibilityLabel="Syncing your products" />
                    )}
                  </div>
                  <Text as="p" tone="subdued">
                    {total
                      ? `${shown} of ${total} products synced.`
                      : `${progress.imported} products synced so far.`}
                  </Text>
                </>
              )}
            </div>
          </Card>
        </div>
      </div>
    </OnboardingLayout>
  );
}
