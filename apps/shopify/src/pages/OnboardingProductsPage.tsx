import { Banner, BlockStack, Button, Card, Spinner, Text } from '@shopify/polaris';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ErrorBanner } from '../components/ErrorBanner';
import { OnboardingLayout } from '../components/OnboardingLayout';
import {
  ProductSelectionStage,
  type StagePick,
} from '../components/onboarding/ProductSelectionStage';
import { apiFetch } from '../lib/api';
import { useBaskets } from '../lib/baskets';
import { type ClassifiedError, classifyError } from '../lib/errors';
import {
  canShowProductsPage,
  getOnboardingStep,
  isBasketsDone,
  isSelectionDone,
  onboardingPath,
} from '../lib/onboarding';
import {
  basketsComplete,
  EMPTY_SELECTION,
  isSelected,
  selectedCount,
  toBasketedBulkBodies,
} from '../lib/productSelection';
import { DEFAULT_SELECTION_FILTER } from '../lib/products';
import type { ShopifyBulkResult, ShopifyMe } from '../types';

const EMPTY_PICK: StagePick = {
  selection: EMPTY_SELECTION,
  filter: DEFAULT_SELECTION_FILTER,
  total: 0,
  items: [],
  baskets: {},
  defaultBasket: '',
};

export default function OnboardingProductsPage({
  me,
  onRefresh,
}: {
  me: ShopifyMe;
  onRefresh: () => Promise<ShopifyMe>;
}) {
  const navigate = useNavigate();
  const { baskets } = useBaskets();
  const [syncing, setSyncing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<ClassifiedError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The picker's current draft: every product it's ever seen is ticked here
  // exactly when the merchant wants it enabled (an already-enabled one starts
  // ticked — see ProductSelectionStage's seeding), with the style chosen for
  // each. Nothing here is saved until Continue is pressed.
  const [pick, setPick] = useState<StagePick>(EMPTY_PICK);

  // Which steps may render this page lives in canShowProductsPage: 'intro' (just
  // arrived from the intro page, nothing synced yet) and 'theme' once baskets
  // are done (the page stays up until the merchant presses Continue) are both
  // legitimate. Only a finished wizard is redirected away.
  const currentStep = getOnboardingStep(me);

  const syncStarted = useRef(false);
  const runSync = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      // The POST only enqueues (202): the import itself runs in a background
      // consumer. Refreshing straight away read 0 synced products and showed the
      // "couldn't find any products" state for a store that was still importing,
      // so wait for the status to go idle first (same approach as ManagePage).
      await apiFetch('/v1/shopify/products/sync', { method: 'POST' });
      const pollIntervalMs = 1500;
      const maxAttempts = 120; // ~3 minutes
      let finished = false;
      for (let attempt = 0; attempt < maxAttempts && !finished; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        const status = await apiFetch<{ state: 'running' | 'idle' }>(
          '/v1/shopify/products/sync/status',
        );
        finished = status.state === 'idle';
      }
      // Still running after the wait: say so rather than let the empty state
      // blame the store's catalogue.
      if (!finished) {
        throw new Error('Importing your products is taking longer than expected. Try again.');
      }
      await onRefresh();
    } catch (err) {
      setError(classifyError(err));
    } finally {
      setSyncing(false);
    }
  }, [onRefresh]);

  // Nothing synced yet: import the catalogue on arrival. The ref makes it run
  // once — an empty store (0 products after syncing) must not loop forever.
  useEffect(() => {
    if (me.stats.syncedProductCount === 0 && !syncStarted.current) {
      syncStarted.current = true;
      void runSync();
    }
  }, [me.stats.syncedProductCount, runSync]);

  // Gates the global-mode "nothing to add" case below; Continue's own gate is
  // the draft's own routed check (picked/routed), not this server snapshot,
  // since nothing here is saved until Continue runs.
  const selectionDone = isSelectionDone(me);
  const picked = selectedCount(pick.selection, pick.total);
  const routed = basketsComplete(pick.selection, pick.baskets, pick.defaultBasket);

  // Saves the whole draft, then moves on — the one place anything in this
  // table reaches the server. A product the merchant unticked that was already
  // live is disabled individually (the bulk endpoint deliberately only ever
  // enables — see products.bulk.ts's comment); everything still ticked is
  // enabled/re-pinned in one bulk call per distinct style, harmless to re-send
  // for a row that was already exactly this.
  const saveAndContinue = useCallback(async () => {
    if (committing || (picked > 0 && !routed)) return;
    setCommitting(true);
    setError(null);
    setNotice(null);
    try {
      const toDisable = pick.items
        .filter((item) => item.enabled && !isSelected(pick.selection, item.shopifyProductId))
        .map((item) => item.shopifyProductId);
      await Promise.all(
        toDisable.map((id) =>
          apiFetch(`/v1/shopify/products/${id}`, {
            method: 'PATCH',
            body: JSON.stringify({ enabled: false }),
          }),
        ),
      );

      if (selectedCount(pick.selection, pick.total) > 0) {
        const bodies = toBasketedBulkBodies(
          pick.selection,
          pick.filter,
          pick.baskets,
          pick.defaultBasket,
        );
        let res: ShopifyBulkResult | null = null;
        let updated = 0;
        for (const body of bodies) {
          const result = await apiFetch<ShopifyBulkResult>('/v1/shopify/products/bulk', {
            method: 'POST',
            body: JSON.stringify(body),
          });
          res ??= result;
          updated = Math.max(updated, result.updated);
        }
        const skipped = res ? res.skipped.notActive + res.skipped.excluded : 0;
        if (skipped > 0 && res) {
          setNotice(
            `${skipped} selected product${skipped === 1 ? ' was' : 's were'} skipped: ${res.skipped.notActive} still processing or failed, ${res.skipped.excluded} excluded.`,
          );
        }
        if (res && updated === 0 && toDisable.length === 0) {
          setNotice(
            'None of the selected products could be enabled — they are still processing, failed to sync, or excluded.',
          );
        }
      }

      const freshMe = await onRefresh();
      if (!isBasketsDone(freshMe)) {
        setError(
          classifyError(
            new Error(
              'At least one product needs to be enabled with a try-on style before you can continue.',
            ),
          ),
        );
        return;
      }
      navigate('/onboarding/contact');
    } catch (err) {
      setError(classifyError(err));
    } finally {
      setCommitting(false);
    }
  }, [committing, picked, routed, pick, onRefresh, navigate]);

  if (!canShowProductsPage(currentStep, me)) {
    return <Navigate to={onboardingPath(currentStep)} replace />;
  }

  // A failed import also leaves 0 synced products; the ErrorBanner (with Retry)
  // covers that, so don't also blame the catalogue with a second retry button.
  const noProducts = !syncing && !error && syncStarted.current && me.stats.syncedProductCount === 0;

  const globalMode = me.store.settings.activation?.mode === 'global';
  const hasCatalogue = !syncing && !noProducts && me.stats.syncedProductCount > 0;

  return (
    <OnboardingLayout
      bare
      page="products"
      heading="Describe Your Garment type for Accurate Virtual Try-On Results"
      // Less top padding than the default — this page's heading is a long
      // sentence, not a short title, so the default's generous top gap left
      // too much dead space above it.
      padding="var(--p-space-800) var(--p-space-800) var(--p-space-1600) var(--p-space-800)"
      continueDisabled={picked > 0 && !routed}
      continueLoading={committing}
      onContinue={saveAndContinue}
    >
      {/* Retry re-imports on a failed sync, or replays the save Continue just
          attempted. */}
      <ErrorBanner
        error={error}
        onRetry={
          me.stats.syncedProductCount === 0 && !syncing
            ? runSync
            : picked === 0 || routed
              ? saveAndContinue
              : undefined
        }
        onDismiss={() => setError(null)}
      />
      {notice && (
        <Banner tone="warning" onDismiss={() => setNotice(null)}>
          {notice}
        </Banner>
      )}
      {syncing && (
        <BlockStack gap="200" inlineAlign="center">
          <Spinner accessibilityLabel="Importing your products" />
          <Text as="p" tone="subdued">
            Importing your products from Shopify…
          </Text>
        </BlockStack>
      )}
      {noProducts && (
        <BlockStack gap="200">
          <Text as="p">
            We couldn't find any products in your store. Add products in Shopify, then try again.
          </Text>
          <div>
            <Button onClick={runSync}>Import again</Button>
          </div>
        </BlockStack>
      )}
      {hasCatalogue && (
        <Card>
          <BlockStack gap="300">
            <Text as="p" tone="subdued">
              Tick the products you want shoppers to try on, then give each one a try-on style.
              Nothing is saved until you press Continue.
            </Text>
            {/* In global mode every product is already enabled without a flag of its
                own, so this table couldn't show them as picks and there is nothing to
                tick. */}
            {!(selectionDone && globalMode) && (
              <>
                <ProductSelectionStage onPickChange={setPick} baskets={baskets} />
                {picked > 0 && !routed && (
                  <Text as="p" tone="caution">
                    Choose a try-on style for every selected product to continue.
                  </Text>
                )}
              </>
            )}
          </BlockStack>
        </Card>
      )}
    </OnboardingLayout>
  );
}
