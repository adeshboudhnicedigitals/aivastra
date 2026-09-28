import { BlockStack, Button, Icon, InlineStack, Text } from '@shopify/polaris';
import { CheckCircleIcon, ExternalIcon, InfoIcon, RefreshIcon } from '@shopify/polaris-icons';
import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import tutorialImage from '../assets/theme-tutorial.png';
import { ErrorBanner } from '../components/ErrorBanner';
import { OnboardingLayout } from '../components/OnboardingLayout';
import { apiFetch } from '../lib/api';
import { type ClassifiedError, classifyError } from '../lib/errors';
import { canShowThemePage, getOnboardingStep, onboardingPath } from '../lib/onboarding';
import type { ShopifyMe } from '../types';

// The panel is white in every colour scheme (see OnboardingShell), so this is a
// fixed light grey rather than a Polaris surface token that would darken.
const GREY_FILL = '#f1f1f1';

// Polaris Button has no size above "large", so the two main buttons are made
// taller through their own class.
const TALL_BUTTONS_CSS = `
.theme-tall-button .Polaris-Button {
  min-height: 56px;
  padding: 0 var(--p-space-600);
  font-size: 16px;
}`;

const THEME_STEPS = [
  {
    title: 'Open Theme Settings',
    description: 'Click the button below to open your theme settings.',
  },
  {
    title: 'Enable the Try It On button',
    description: 'Make sure Try It On is switched on.',
  },
  {
    title: 'Save your changes',
    description: 'Click Save to apply the changes',
  },
];

export default function OnboardingThemePage({
  me,
  onRefresh,
}: {
  me: ShopifyMe;
  onRefresh: () => Promise<ShopifyMe>;
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
      bare
      page="theme"
      hideBack={currentStep === null}
      continueLabel="Finish Setup"
      onContinue={() => navigate('/')}
      continueDisabled={!themeEmbedDone}
      fullWidth
      padding="var(--p-space-600) var(--p-space-1600)"
    >
      <BlockStack gap="300">
        <ErrorBanner error={error} onDismiss={() => setError(null)} />
        {/* Instructions on the left, the screenshot they refer to on the right;
            the two wrap onto separate rows on a narrow window. */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 'var(--p-space-800)',
            alignItems: 'center',
          }}
        >
          <div style={{ flex: '1 1 380px', minWidth: 0 }}>
            <BlockStack gap="500">
              {/* Plain h1 for the same reason as the other onboarding headings:
                  Polaris Text tops out at 28px. */}
              <h1 style={{ margin: 0, fontSize: 34, lineHeight: 1.15, fontWeight: 700 }}>
                Enable Virtual Try-On Button
              </h1>
              <Text as="p" tone="subdued">
                Add the AI Vastra – Try It On button to your product pages so customers can try on
                your products directly in your store.
              </Text>
              <BlockStack gap="300">
                {THEME_STEPS.map((step, index) => (
                  <InlineStack key={step.title} gap="400" blockAlign="start" wrap={false}>
                    <div
                      style={{
                        width: 44,
                        height: 44,
                        flex: 'none',
                        borderRadius: '50%',
                        background: GREY_FILL,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 700,
                        fontSize: 16,
                      }}
                    >
                      {index + 1}
                    </div>
                    <BlockStack gap="050">
                      <Text as="span" fontWeight="semibold">
                        {step.title}
                      </Text>
                      <Text as="span" tone="subdued">
                        {step.description}
                      </Text>
                    </BlockStack>
                  </InlineStack>
                ))}
              </BlockStack>
              <div className="theme-tall-button">
                <style>{TALL_BUTTONS_CSS}</style>
                <BlockStack gap="300">
                  <Button
                    variant="primary"
                    size="large"
                    fullWidth
                    icon={ExternalIcon}
                    onClick={openThemeEditor}
                    loading={openingEditor}
                    disabled={themeEmbedDone}
                  >
                    Open theme settings
                  </Button>
                  <Button
                    size="large"
                    fullWidth
                    icon={RefreshIcon}
                    onClick={checkStatus}
                    loading={checking}
                    disabled={themeEmbedDone}
                  >
                    Refresh status
                  </Button>
                </BlockStack>
              </div>
              <div
                style={{ background: GREY_FILL, borderRadius: 12, padding: 'var(--p-space-400)' }}
              >
                {themeEmbedDone ? (
                  <InlineStack gap="200" blockAlign="center" wrap={false}>
                    {/* Polaris Icon has `margin: auto`, which in a flex row soaks up the free
                        space and drifts the icon (and the text after it) to the middle of
                        the row. A shrink-wrapped wrapper leaves it nothing to absorb. */}
                    <div style={{ display: 'flex', flex: 'none' }}>
                      <Icon source={CheckCircleIcon} tone="success" />
                    </div>
                    <Text as="span" tone="success" fontWeight="semibold">
                      AI Vastra virtual try-on already activated
                    </Text>
                  </InlineStack>
                ) : (
                  <InlineStack gap="300" blockAlign="start" wrap={false}>
                    <div style={{ display: 'flex', flex: 'none' }}>
                      <Icon source={InfoIcon} tone="subdued" />
                    </div>
                    <BlockStack gap="200">
                      <Text as="p" tone="subdued">
                        If Save is greyed out, it's already enabled. Then open any product page on
                        your store and press Refresh status — we'll detect the button and unlock
                        Finish Setup.
                      </Text>
                      {checkedNotFound && (
                        <Text as="p" tone="caution">
                          Not detected yet. Make sure the embed is saved, then load a product page
                          on your live store (not the theme editor preview) and refresh again.
                        </Text>
                      )}
                    </BlockStack>
                  </InlineStack>
                )}
              </div>
            </BlockStack>
          </div>
          <div style={{ flex: '1.4 1 480px', minWidth: 0 }}>
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
          </div>
        </div>
      </BlockStack>
    </OnboardingLayout>
  );
}
