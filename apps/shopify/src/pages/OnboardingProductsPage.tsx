import { Banner, BlockStack, Button, Card, InlineStack, Spinner, Text } from '@shopify/polaris';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ErrorBanner } from '../components/ErrorBanner';
import { OnboardingLayout } from '../components/OnboardingLayout';
import { BasketAssignmentStage } from '../components/onboarding/BasketAssignmentStage';
import { EnabledProductsList } from '../components/onboarding/EnabledProductsList';
import type { StagePick } from '../components/onboarding/ProductSelectionStage';
import { SelectedProductsList } from '../components/onboarding/SelectedProductsList';
import { SelectProductsModal } from '../components/onboarding/SelectProductsModal';
import { apiFetch } from '../lib/api';
import { type ClassifiedError, classifyError } from '../lib/errors';
import {
  canShowProductsPage,
  getOnboardingProgress,
  getOnboardingStep,
  isBasketsDone,
  isSelectionDone,
  onboardingPath,
} from '../lib/onboarding';
import { EMPTY_SELECTION, selectedCount, toBulkTarget } from '../lib/productSelection';
import { DEFAULT_SELECTION_FILTER } from '../lib/products';
import type { ShopifyBulkResult, ShopifyMe } from '../types';

const EMPTY_PICK: StagePick = {
  selection: EMPTY_SELECTION,
  filter: DEFAULT_SELECTION_FILTER,
  total: 0,
  items: [],
};

export default function OnboardingProductsPage({
  me,
  onRefresh,
}: {
  me: ShopifyMe;
  onRefresh: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const [syncing, setSyncing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<ClassifiedError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // The confirmed pick: what the picker modal last returned, and what Continue commits.
  const [pick, setPick] = useState<StagePick>(EMPTY_PICK);

  // Which steps may render this page lives in canShowProductsPage: 'intro' (just
  // arrived from the intro page, nothing synced yet) and 'theme' once baskets
  // are done (stage 2 stays up until the merchant presses Continue) are both
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

  if (!canShowProductsPage(currentStep, me)) {
    return <Navigate to={onboardingPath(currentStep)} replace />;
  }

  // The stage follows the data, so a reload lands on the right one. There is no
  // Back between stages: the selection is committed when stage 1 is left, and
  // changing it afterwards happens in Manage.
  const selectionDone = isSelectionDone(me);
  const basketsDone = isBasketsDone(me);
  const picked = selectedCount(pick.selection, pick.total);

  // Enables a pick. Used for the first confirmation and for "add more" afterwards.
  async function enablePick(toEnable: StagePick) {
    if (selectedCount(toEnable.selection, toEnable.total) === 0 || committing) return;
    setCommitting(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetch<ShopifyBulkResult>('/v1/shopify/products/bulk', {
        method: 'POST',
        body: JSON.stringify({
          target: toBulkTarget(toEnable.selection, toEnable.filter),
          enabled: true,
        }),
      });
      const skipped = res.skipped.notActive + res.skipped.excluded;
      if (res.updated === 0) {
        setNotice(
          'None of the selected products could be enabled — they are still processing, failed to sync, or excluded.',
        );
      } else if (skipped > 0) {
        setNotice(
          `${skipped} selected product${skipped === 1 ? ' was' : 's were'} skipped: ${res.skipped.notActive} still processing or failed, ${res.skipped.excluded} excluded.`,
        );
      }
      // The products are enabled now; the draft has done its job and would only go stale.
      setPick(EMPTY_PICK);
      await onRefresh();
    } catch (err) {
      setError(classifyError(err));
    } finally {
      setCommitting(false);
    }
  }

  // A failed import also leaves 0 synced products; the ErrorBanner (with Retry)
  // covers that, so don't also blame the catalogue with a second retry button.
  const noProducts = !syncing && !error && syncStarted.current && me.stats.syncedProductCount === 0;

  const globalMode = me.store.settings.activation?.mode === 'global';
  const enabledTotal = me.stats.enabledProductCount + (me.stats.unroutedEnabledCount ?? 0);
  const hasCatalogue = !syncing && !noProducts && me.stats.syncedProductCount > 0;

  return (
    <OnboardingLayout
      bare
      progress={getOnboardingProgress(me, 'products')}
      heading="Set up your first try-on"
      continueDisabled={!(selectionDone && basketsDone)}
      onContinue={() => navigate('/onboarding/contact')}
    >
      {/* Retry only makes sense for a failed import; a failed bulk save is retried by pressing Confirm again. */}
      <ErrorBanner
        error={error}
        onRetry={me.stats.syncedProductCount === 0 && !syncing ? runSync : undefined}
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
        <>
          <Card>
            <BlockStack gap="300">
              <Text as="p" tone="subdued">
                Step 1
              </Text>
              <Text as="h2" variant="headingLg">
                Choose your products
              </Text>
              {selectionDone ? (
                <>
                  <Text as="p">
                    {enabledTotal} product{enabledTotal === 1 ? '' : 's'} enabled for try-on. You
                    can still add or remove products here.
                  </Text>
                  <div>
                    <Button loading={committing} onClick={() => setPickerOpen(true)}>
                      Add more products
                    </Button>
                  </div>
                  {/* In global mode products have no per-product enabled flag, so
                      there is nothing to list or remove; Manage handles those stores. */}
                  {!globalMode && (
                    <EnabledProductsList version={enabledTotal} onChanged={onRefresh} />
                  )}
                </>
              ) : (
                <>
                  <Text as="p" tone={picked === 0 ? 'subdued' : undefined}>
                    {picked === 0
                      ? 'Choose the products you want shoppers to try on.'
                      : `${picked} product${picked === 1 ? '' : 's'} selected.`}
                  </Text>
                  {/* Wrapped so the buttons keep their natural width while the list below fills the card. */}
                  <div>
                    <InlineStack gap="200">
                      <Button
                        variant={picked === 0 ? 'primary' : undefined}
                        onClick={() => setPickerOpen(true)}
                      >
                        Select products
                      </Button>
                      {picked > 0 && (
                        <Button
                          variant="primary"
                          loading={committing}
                          onClick={() => enablePick(pick)}
                        >
                          {`Confirm ${picked} product${picked === 1 ? '' : 's'}`}
                        </Button>
                      )}
                    </InlineStack>
                  </div>
                  <SelectedProductsList pick={pick} onChange={setPick} />
                </>
              )}
              <SelectProductsModal
                open={pickerOpen}
                initial={selectionDone ? EMPTY_PICK : pick}
                onCancel={() => setPickerOpen(false)}
                onConfirm={(confirmed) => {
                  setPickerOpen(false);
                  // Before the first confirmation the pick is a draft; after it, the
                  // selection is live, so adding takes effect immediately.
                  if (selectionDone) void enablePick(confirmed);
                  else setPick(confirmed);
                }}
              />
            </BlockStack>
          </Card>
          {/* Locked until step 1 is confirmed: baskets are assigned to enabled products. */}
          <Card>
            <BlockStack gap="300">
              <Text as="p" tone="subdued">
                Step 2
              </Text>
              <Text as="h2" variant="headingLg">
                Choose a basket for your products
              </Text>
              {selectionDone ? (
                <BasketAssignmentStage me={me} onRefresh={onRefresh} />
              ) : (
                <Text as="p" tone="subdued">
                  Confirm your products above, then choose a basket for them here.
                </Text>
              )}
            </BlockStack>
          </Card>
        </>
      )}
    </OnboardingLayout>
  );
}
