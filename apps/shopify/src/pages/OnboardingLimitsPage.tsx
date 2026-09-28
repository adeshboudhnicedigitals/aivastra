import { BlockStack, Checkbox, Select, Text } from '@shopify/polaris';
import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ErrorBanner } from '../components/ErrorBanner';
import { OnboardingLayout } from '../components/OnboardingLayout';
import { apiFetch } from '../lib/api';
import { type ClassifiedError, classifyError } from '../lib/errors';
import { numericOptions, OFF, resolveNumericLimit } from '../lib/limits';
import { canShowPostBasketPage, getOnboardingStep, onboardingPath } from '../lib/onboarding';
import type { ShopifyMe, ShopifyStoreLimits } from '../types';

// Onboarding's own subset of Settings → Limits' full PER_SHOPPER_CAP_OPTIONS —
// fewer choices, friendlier labels, no window selector (this step always means
// "per day"). All five values are still in the API-accepted set, so no backend
// change is needed to show only these.
const ONBOARDING_TRYON_CAP_OPTIONS = [1, 2, 3, 5, 10];
const ONBOARDING_TRYON_CAP_PRESELECTED = 5;

/**
 * Onboarding's try-on-usage step: a simplified try-ons-per-day limit and a
 * plain require/don't-require toggle for email, both writing the same
 * `ShopifyStoreLimits` fields Settings → Limits edits with its fuller controls
 * (any window, "ask after N tries" instead of a flat require). Everything
 * defaults to off, so Continue with no changes writes nothing and leaves the
 * store exactly as it was. Not a gate: nothing here feeds the derived
 * onboarding step.
 */
export default function OnboardingLimitsPage({
  me,
  onRefresh,
}: {
  me: ShopifyMe;
  onRefresh: () => Promise<ShopifyMe>;
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
  // perShopperWindow is fixed to 'day' whenever a cap is set here — this step's
  // copy says "per day" outright, not "resets every ___" like Settings' fuller
  // version does. Left alone (whatever Settings last saved) while the cap is
  // off, since it has no effect there and this page must not silently overwrite
  // a window a merchant already configured from Settings.
  const draft = {
    perShopperCap: limits.perShopperCap ?? null,
    perShopperWindow: limits.perShopperCap == null ? (saved.perShopperWindow ?? null) : 'day',
    emailAfterNTryOns: limits.emailAfterNTryOns ?? null,
  };
  const changed =
    draft.perShopperCap !== (saved.perShopperCap ?? null) ||
    draft.perShopperWindow !== (saved.perShopperWindow ?? null) ||
    draft.emailAfterNTryOns !== (saved.emailAfterNTryOns ?? null);
  // "Required" only reads true for the immediate/"before first try-on" threshold
  // (0) — any other saved value (e.g. "ask after 2", set from Settings' fuller
  // control) reads as not-required here rather than collapsing onto it.
  const emailRequired = limits.emailAfterNTryOns === 0;

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
      page="limits"
      title="Virtual Try-On Usage"
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
            <BlockStack gap="300">
              <Text as="h2" variant="headingLg" fontWeight="bold">
                Try-Ons Per Customer
              </Text>
              <Text as="p" tone="subdued">
                Choose how many times each customer can use Virtual Try-On per day
              </Text>
              <Select
                label="Try-Ons Allowed"
                options={numericOptions(ONBOARDING_TRYON_CAP_OPTIONS, 'Unlimited', (n) =>
                  n === 1 ? '1 Try-On' : `${n} Try-Ons`,
                )}
                value={limits.perShopperCap == null ? OFF : String(limits.perShopperCap)}
                onChange={(v) =>
                  patchLimits({
                    perShopperCap:
                      v === OFF ? null : resolveNumericLimit(v, ONBOARDING_TRYON_CAP_PRESELECTED),
                  })
                }
              />
            </BlockStack>
            <Checkbox
              label="Make Email Required"
              helpText="When enabled, customers must enter their email address to continue."
              checked={emailRequired}
              onChange={(checked) => patchLimits({ emailAfterNTryOns: checked ? 0 : null })}
            />
            <Text as="p" tone="subdued" alignment="center">
              You can change these settings anytime under Settings → Limits.
            </Text>
          </BlockStack>
        </div>
      </BlockStack>
    </OnboardingLayout>
  );
}
