import { BlockStack, Button, Text } from '@shopify/polaris';
import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ErrorBanner } from '../components/ErrorBanner';
import { OnboardingLayout } from '../components/OnboardingLayout';
import { apiFetch } from '../lib/api';
import { type ClassifiedError, classifyError } from '../lib/errors';
import { getOnboardingStep, onboardingPath } from '../lib/onboarding';
import type { ShopifyMe } from '../types';

export default function OnboardingProductsPage({
  me,
  onRefresh,
}: {
  me: ShopifyMe;
  onRefresh: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<ClassifiedError | null>(null);

  // Arriving here from the intro page's own Continue button is legitimate
  // even though getOnboardingStep still reports 'intro' at that instant —
  // nothing has synced yet, so the derived step can't have advanced. Only
  // reject a genuinely wrong step (e.g. a merchant typing /onboarding/theme
  // directly while still on 'routing').
  const currentStep = getOnboardingStep(me);
  if (currentStep !== 'products' && currentStep !== 'intro') {
    return <Navigate to={onboardingPath(currentStep)} replace />;
  }

  const synced = me.stats.syncedProductCount > 0;
  const enabled =
    me.store.settings.activation?.mode === 'global' || me.stats.enabledProductCount > 0;
  const done = synced && enabled;

  async function syncProducts() {
    setSyncing(true);
    setError(null);
    try {
      await apiFetch('/v1/shopify/products/sync', { method: 'POST' });
      const globalModeOn = me.store.settings.activation?.mode === 'global';
      const alreadyEnabled = globalModeOn || me.stats.enabledProductCount > 0;
      // A store that's already completed onboarding once (and later
      // regressed here — see App.tsx's gate) may have a deliberate selective
      // setup with nothing currently enabled. Only the genuine first-time
      // path gets the "sync also turns try-on on" convenience.
      const hasCompletedOnboardingOnce = me.store.settings.onboardingCompletedOnce ?? false;
      if (!alreadyEnabled && !hasCompletedOnboardingOnce) {
        await apiFetch('/v1/shopify/activation/mode', {
          method: 'PATCH',
          body: JSON.stringify({ mode: 'global' }),
        });
      }
      await onRefresh();
    } catch (err) {
      setError(classifyError(err));
    } finally {
      setSyncing(false);
    }
  }

  return (
    <OnboardingLayout
      step={1}
      totalSteps={3}
      title="Bring in your products"
      onContinue={() => navigate('/onboarding/routing')}
      continueDisabled={!done}
    >
      <BlockStack gap="300">
        <ErrorBanner error={error} onRetry={syncProducts} />
        <Text as="p">
          Import your Shopify catalog and turn on virtual try-on for every product — you can exclude
          specific ones afterward in Manage.
        </Text>
        <Button variant="primary" onClick={syncProducts} loading={syncing} disabled={done}>
          {done ? 'Products synced' : 'Sync products now'}
        </Button>
        {done && (
          <Text as="p" tone="success">
            {me.stats.syncedProductCount} products synced — virtual try-on is live.
          </Text>
        )}
      </BlockStack>
    </OnboardingLayout>
  );
}
