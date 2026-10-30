import { Banner, BlockStack, Button, Card, ProgressBar, Spinner, Text } from '@shopify/polaris';
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
  }, [onRefresh]);
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
  const percent =
    progress.total && progress.total > 0
      ? Math.min(100, Math.round((progress.imported / progress.total) * 100))
      : 0;
  return (
    <OnboardingLayout
      bare
      page="products"
      heading="Importing your products"
      continueDisabled={syncing || imported === 0}
      continueLoading={false}
      onContinue={() => navigate('/onboarding/contact')}
    >
      <ErrorBanner
        error={error}
        onRetry={imported === 0 && !syncing ? runSync : undefined}
        onDismiss={() => setError(null)}
      />
      {syncing && (
        <Card>
          <BlockStack gap="300">
            {progress.total ? (
              <>
                <ProgressBar progress={percent} size="small" />
                <Text as="p" tone="subdued">
                  {Math.min(progress.imported, progress.total)}/{progress.total} products imported
                </Text>
              </>
            ) : (
              <BlockStack gap="200" inlineAlign="center">
                <Spinner accessibilityLabel="Importing your products" />
                <Text as="p" tone="subdued">
                  Importing your products from Shopify… {progress.imported} so far
                </Text>
              </BlockStack>
            )}
          </BlockStack>
        </Card>
      )}
      {noProducts && (
        <BlockStack gap="200">
          <Text as="p">
            We couldn&apos;t find any products in your store. Add products in Shopify, then try
            again.
          </Text>
          <div>
            <Button size="large" onClick={runSync}>
              Import again
            </Button>
          </div>
        </BlockStack>
      )}
      {!syncing && imported > 0 && (
        <Banner tone="success">
          {imported} product{imported === 1 ? '' : 's'} imported. Try-on will be on for all of them;
          you can exclude products later in Manage.
        </Banner>
      )}
    </OnboardingLayout>
  );
}
