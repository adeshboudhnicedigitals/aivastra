import { BlockStack, Button, Icon, InlineGrid, InlineStack, List, Text } from '@shopify/polaris';
import { CheckCircleIcon, ExternalIcon, RefreshIcon } from '@shopify/polaris-icons';
import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import tutorialImage from '../assets/theme-tutorial.png';
import { ErrorBanner } from '../components/ErrorBanner';
import { OnboardingLayout } from '../components/OnboardingLayout';
import { apiFetch } from '../lib/api';
import { type ClassifiedError, classifyError } from '../lib/errors';
import {
  canShowThemePage,
  getOnboardingProgress,
  getOnboardingStep,
  onboardingPath,
} from '../lib/onboarding';
import type { ShopifyMe } from '../types';

export default function OnboardingThemePage({
  me,
  onRefresh,
}: {
  me: ShopifyMe;
  onRefresh: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const [openingEditor, setOpeningEditor] = useState(false);
  const [checking, setChecking] = useState(false);
  // Set once the merchant has pressed Refresh and it still isn't detected, so the
  // page can say so instead of leaving them wondering whether anything happened.
  const [checkedNotFound, setCheckedNotFound] = useState(false);
  const [error, setError] = useState<ClassifiedError | null>(null);

  // Both flags are set together by the storefront ping (see markThemeEmbedSeen
  // in the API), so the newer one is the one this page waits on.
  const themeEmbedDone = me.store.settings.themeEmbedConfirmed ?? false;

  // The embed is switched on in another tab and detected the first time the
  // widget loads on a live product page, so there is nothing to click here —
  // just look again on a timer and whenever the merchant comes back to this tab.
  useEffect(() => {
    if (themeEmbedDone) return;
    const refresh = () => {
      if (document.visibilityState === 'visible') void onRefresh().catch(() => {});
    };
    const timer = setInterval(refresh, 5000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [themeEmbedDone, onRefresh]);

  // The merchant enables the embed in the theme editor's own tab and comes back
  // to this page, which stays open. Refresh re-reads the store's status now
  // instead of waiting for the 5s timer above.
  async function checkStatus() {
    setChecking(true);
    setError(null);
    try {
      await onRefresh();
      setCheckedNotFound(true);
    } catch (err) {
      setError(classifyError(err));
    } finally {
      setChecking(false);
    }
  }

  const currentStep = getOnboardingStep(me);
  if (!canShowThemePage(currentStep)) {
    return <Navigate to={onboardingPath(currentStep)} replace />;
  }

  async function openThemeEditor() {
    setOpeningEditor(true);
    setError(null);
    try {
      const { url } = await apiFetch<{ url: string }>('/v1/shopify/onboarding/theme-editor-url');
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      setError(classifyError(err));
    } finally {
      setOpeningEditor(false);
    }
  }

  return (
    <OnboardingLayout
      progress={getOnboardingProgress(me, 'theme')}
      title="Enable the Try It On in your Theme Settings"
      onContinue={() => navigate('/')}
      continueDisabled={!themeEmbedDone}
      fullWidth
      card={false}
    >
      <BlockStack gap="300">
        <ErrorBanner error={error} onDismiss={() => setError(null)} />
        {/* Steps and buttons on the left, the screenshot they refer to on the
            right; stacks on a narrow window. */}
        <InlineGrid
          columns={{ xs: 1, md: ['oneThird', 'twoThirds'] }}
          gap="600"
          alignItems="center"
        >
          <BlockStack gap="400">
            <List type="number">
              <List.Item>Click on the button below</List.Item>
              <List.Item>Make sure the AIVastra script ("Try It On") is switched on</List.Item>
              <List.Item>Click on "Save"</List.Item>
            </List>
            <InlineStack gap="200">
              <Button
                icon={ExternalIcon}
                onClick={openThemeEditor}
                loading={openingEditor}
                disabled={themeEmbedDone}
              >
                Open theme settings
              </Button>
              <Button
                icon={RefreshIcon}
                onClick={checkStatus}
                loading={checking}
                disabled={themeEmbedDone}
              >
                Refresh status
              </Button>
            </InlineStack>
            {themeEmbedDone ? (
              <InlineStack gap="100" blockAlign="center" wrap={false}>
                {/* Polaris Icon has `margin: auto`, which in a flex row soaks up the free
                    space and drifts the icon (and the text after it) to the middle of
                    the row. A shrink-wrapped wrapper leaves it nothing to absorb. */}
                <div style={{ display: 'flex', flex: 'none' }}>
                  <Icon source={CheckCircleIcon} tone="success" />
                </div>
                <Text as="span" tone="success" fontWeight="semibold">
                  AIVastra script already activated
                </Text>
              </InlineStack>
            ) : (
              <BlockStack gap="100">
                <Text as="p" tone="subdued">
                  If Save is greyed out, it was already on and saved. Then open any product page on
                  your store and press Refresh status — we detect the button there and unlock
                  Continue.
                </Text>
                {checkedNotFound && (
                  <Text as="p" tone="caution">
                    Not detected yet. Make sure the embed is saved, then load a product page on your
                    live store (not the theme editor preview) and refresh again.
                  </Text>
                )}
              </BlockStack>
            )}
          </BlockStack>
          {/* The numbers in the screenshot match the steps in the list. */}
          {/* biome-ignore lint/performance/noImgElement: Polaris has no plain image component */}
          <img
            src={tutorialImage}
            alt="The theme editor's App embeds panel with the Try It On switch marked 1 and the Save button marked 2"
            style={{
              display: 'block',
              width: '100%',
              borderRadius: 8,
              border: '1px solid var(--p-color-border)',
            }}
          />
        </InlineGrid>
      </BlockStack>
    </OnboardingLayout>
  );
}
