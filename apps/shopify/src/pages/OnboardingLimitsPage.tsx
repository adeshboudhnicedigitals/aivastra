import { BlockStack, Text } from '@shopify/polaris';
import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ErrorBanner } from '../components/ErrorBanner';
import { OnboardingLayout } from '../components/OnboardingLayout';
import { AskForEmailCard, PerShopperLimitCard } from '../components/ShopperLimitCards';
import { apiFetch } from '../lib/api';
import { type ClassifiedError, classifyError } from '../lib/errors';
import {
  canShowPostBasketPage,
  getOnboardingProgress,
  getOnboardingStep,
  onboardingPath,
} from '../lib/onboarding';
import type { ShopifyMe, ShopifyStoreLimits } from '../types';

/**
 * Onboarding's shopper-limits step: the per-shopper limit and the ask-for-an-email
 * setting, the same two controls as Settings → Limits (shared cards), so a merchant
 * decides them up front and can still change them later in Settings. Everything
 * defaults to off, so Continue with no changes writes nothing and leaves the store
 * exactly as it was. Not a gate: nothing here feeds the derived onboarding step.
 */
export default function OnboardingLimitsPage({
  me,
  onRefresh,
}: {
  me: ShopifyMe;
  onRefresh: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const saved = me.store.settings.limits ?? {};
  const [limits, setLimits] = useState<ShopifyStoreLimits>(saved);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ClassifiedError | null>(null);

  const currentStep = getOnboardingStep(me);
  if (!canShowPostBasketPage(currentStep)) {
    return <Navigate to={onboardingPath(currentStep)} replace />;
  }

  // Only the three settings this page shows are sent. The API merges limits, so
  // the store daily limit (edited only in Settings) is left alone.
  const draft = {
    perShopperCap: limits.perShopperCap ?? null,
    perShopperWindow: limits.perShopperWindow,
    emailAfterNTryOns: limits.emailAfterNTryOns ?? null,
  };
  const changed =
    draft.perShopperCap !== (saved.perShopperCap ?? null) ||
    draft.perShopperWindow !== saved.perShopperWindow ||
    draft.emailAfterNTryOns !== (saved.emailAfterNTryOns ?? null);

  async function saveAndContinue() {
    if (saving) return;
    if (!changed) {
      navigate('/onboarding/theme');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiFetch('/v1/shopify/settings', {
        method: 'PATCH',
        body: JSON.stringify({ limits: draft }),
      });
      await onRefresh();
      navigate('/onboarding/theme');
    } catch (err) {
      setError(classifyError(err));
    } finally {
      setSaving(false);
    }
  }

  const patchLimits = (patch: Partial<ShopifyStoreLimits>) =>
    setLimits((prev) => ({ ...prev, ...patch }));

  return (
    <OnboardingLayout
      progress={getOnboardingProgress(me, 'limits')}
      title="Shopper limits"
      titleAlign="center"
      largeTitle
      onContinue={saveAndContinue}
      continueLoading={saving}
      card={false}
    >
      <BlockStack gap="400">
        <ErrorBanner error={error} onDismiss={() => setError(null)} />
        <div style={{ width: '100%', maxWidth: 760, margin: 'var(--p-space-800) auto 0' }}>
          <BlockStack gap="600">
            <PerShopperLimitCard bare limits={limits} onChange={patchLimits} />
            <AskForEmailCard bare limits={limits} onChange={patchLimits} />
            <Text as="p" tone="subdued" alignment="center">
              You can change these anytime on the Settings page, under Limits.
            </Text>
          </BlockStack>
        </div>
      </BlockStack>
    </OnboardingLayout>
  );
}
