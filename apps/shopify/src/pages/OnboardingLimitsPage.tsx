import { Select } from '@shopify/polaris';
import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ErrorBanner } from '../components/ErrorBanner';
import { OnboardingLayout } from '../components/OnboardingLayout';
import { Glyph, PageHead } from '../components/PageHead';
import { apiFetch } from '../lib/api';
import { type ClassifiedError, classifyError } from '../lib/errors';
import { loginRequiredPatch, numericOptions, OFF, resolveNumericLimit } from '../lib/limits';
import { canShowPostProductsPage, getOnboardingStep, onboardingPath } from '../lib/onboarding';
import type { ShopifyMe, ShopifyStoreLimits } from '../types';

// Onboarding's own subset of Settings → Limits' full PER_SHOPPER_CAP_OPTIONS —
// fewer choices, friendlier labels, no window selector (this step always means
// "per day"). All five values are still in the API-accepted set, so no backend
// change is needed to show only these.
const ONBOARDING_TRYON_CAP_OPTIONS = [1, 2, 3, 5, 10];
const ONBOARDING_TRYON_CAP_PRESELECTED = 5;

/**
 * Onboarding's try-on-usage step: a simplified try-ons-per-day limit and a
 * plain require/don't-require toggle for login, both writing the same
 * `ShopifyStoreLimits` fields Settings → Limits edits with its fuller controls
 * (any window, "ask after N tries" instead of a flat require). The limit
 * defaults to off and login to required for a store with no saved choice. Not a gate: nothing here feeds the
 * derived onboarding step.
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
  // Login required starts ticked for a store that never chose either way, so
  // Continue saves it; a saved choice (true or false) is kept as is.
  const [limits, setLimits] = useState<ShopifyStoreLimits>({
    ...saved,
    loginRequired: saved.loginRequired ?? true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ClassifiedError | null>(null);

  const currentStep = getOnboardingStep(me);
  if (!canShowPostProductsPage(currentStep)) {
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
    loginRequired: limits.loginRequired === true,
  };
  const changed =
    draft.perShopperCap !== (saved.perShopperCap ?? null) ||
    draft.perShopperWindow !== (saved.perShopperWindow ?? null) ||
    draft.loginRequired !== (saved.loginRequired === true);
  // "Required" only reads true for the immediate/"before first try-on" threshold
  // (0) — any other saved value (e.g. "ask after 2", set from Settings' fuller
  // control) reads as not-required here rather than collapsing onto it.
  const loginRequired = limits.loginRequired === true;

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
        // The API accepts an absent window but not a null one.
        body: JSON.stringify({
          limits: {
            perShopperCap: draft.perShopperCap,
            ...(draft.perShopperWindow ? { perShopperWindow: draft.perShopperWindow } : {}),
            loginRequired: draft.loginRequired,
          },
        }),
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
      bare
      page="limits"
      fullWidth
      padding="var(--p-space-400)"
      onContinue={saveAndContinue}
      continueLoading={saving}
    >
      <div style={{ maxWidth: 1040, width: '100%', margin: '0 auto' }}>
        <PageHead
          icon={
            <Glyph size={44}>
              <path d="M3.5 8h17M3.5 16h17" />
              <circle cx="9" cy="8" r="2.6" fill="#ebe6fc" />
              <circle cx="15" cy="16" r="2.6" fill="#ebe6fc" />
            </Glyph>
          }
          title="Customize Widget"
          subtitle="Configure how customers use Virtual Try-On on your store."
        />
        <div style={{ marginTop: 12 }}>
          <ErrorBanner error={error} onDismiss={() => setError(null)} />
        </div>
        <div className="av-panel" style={{ marginTop: 'var(--av-gap)' }}>
          <div className="av-row">
            <div>
              <h2 className="av-rt">Try-ons per customer</h2>
              <p className="av-rd">
                Set the maximum number of try-ons each customer can perform per day.
              </p>
            </div>
            <div className="av-selw">
              <Select
                label="Try-ons per customer"
                labelHidden
                options={numericOptions(ONBOARDING_TRYON_CAP_OPTIONS, 'Unlimited', (n) =>
                  n === 1 ? '1 Tryon' : `${n} Tryons`,
                )}
                value={limits.perShopperCap == null ? OFF : String(limits.perShopperCap)}
                onChange={(v) =>
                  patchLimits({
                    perShopperCap:
                      v === OFF ? null : resolveNumericLimit(v, ONBOARDING_TRYON_CAP_PRESELECTED),
                  })
                }
              />
            </div>
          </div>
          <div className="av-row">
            <div>
              <h2 className="av-rt" id="loginLabel">
                Require customer login
              </h2>
              <p className="av-rd">
                Shoppers sign in to your store first, so you know who is trying on. If their account
                has no email or phone number, we ask for it before their first try-on.
              </p>
            </div>
            <button
              type="button"
              className="av-sw"
              role="switch"
              aria-checked={loginRequired}
              aria-labelledby="loginLabel"
              onClick={() => patchLimits(loginRequiredPatch(!loginRequired))}
            >
              <span />
            </button>
          </div>
        </div>
        <p
          style={{
            textAlign: 'center',
            color: '#5d5b78',
            fontSize: 15,
            marginTop: 'var(--av-gap)',
          }}
        >
          You can change these limits anytime under Settings → Limits.
        </p>
      </div>
    </OnboardingLayout>
  );
}
