import { BlockStack, Button, Text } from '@shopify/polaris';
import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ErrorBanner } from '../components/ErrorBanner';
import { OnboardingLayout } from '../components/OnboardingLayout';
import { apiFetch } from '../lib/api';
import { type ClassifiedError, classifyError } from '../lib/errors';
import { getOnboardingStep, onboardingPath } from '../lib/onboarding';
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
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<ClassifiedError | null>(null);

  const currentStep = getOnboardingStep(me);
  if (currentStep !== 'theme') {
    return <Navigate to={onboardingPath(currentStep)} replace />;
  }

  const themeBlockDone = me.store.settings.themeBlockConfirmed ?? false;

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

  async function confirmThemeBlock() {
    setConfirming(true);
    setError(null);
    try {
      await apiFetch('/v1/shopify/onboarding/confirm-theme-block', { method: 'POST' });
      await onRefresh();
    } catch (err) {
      setError(classifyError(err));
    } finally {
      setConfirming(false);
    }
  }

  return (
    <OnboardingLayout
      step={3}
      totalSteps={3}
      title="Add the Try It On block to your product page"
      onContinue={() => navigate('/')}
      continueDisabled={!themeBlockDone}
    >
      <BlockStack gap="300">
        <ErrorBanner error={error} onDismiss={() => setError(null)} />
        <Text as="p">
          Required — the try-on button only appears where you place this block. Open the theme
          editor, drag it directly above the Buy Buttons block, then save.
        </Text>
        <BlockStack gap="200">
          <Button onClick={openThemeEditor} loading={openingEditor}>
            Open theme editor
          </Button>
          <Button
            variant="primary"
            onClick={confirmThemeBlock}
            loading={confirming}
            disabled={themeBlockDone}
          >
            {themeBlockDone ? 'Block confirmed' : "I've added it"}
          </Button>
        </BlockStack>
      </BlockStack>
    </OnboardingLayout>
  );
}
