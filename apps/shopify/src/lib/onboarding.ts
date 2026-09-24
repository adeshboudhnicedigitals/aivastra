import type { ShopifyMe } from '../types';

export type OnboardingStep = 'intro' | 'products' | 'routing' | 'theme';

// Mirrors DashboardPage's own isTryOnEnabled: global mode alone counts as
// "enabled" regardless of enabledProductCount's precision.
function isTryOnEnabled(me: ShopifyMe): boolean {
  const globalModeOn = me.store.settings.activation?.mode === 'global';
  return globalModeOn || me.stats.enabledProductCount > 0;
}

/**
 * The wizard's current step, or null once every step is done. Intro has no
 * settings flag of its own — it is shown only when none of the three real
 * steps are done yet (a genuinely fresh install); as soon as any one of them
 * is done, a merchant resuming the wizard jumps straight to the first
 * incomplete step among products/routing/theme, in that fixed order,
 * regardless of which one they happened to finish first (a store could have
 * themeBlockConfirmed=true from before this wizard existed, but never have
 * synced products — that still resumes at 'products', not 'intro').
 */
export function getOnboardingStep(me: ShopifyMe): OnboardingStep | null {
  const productsDone = me.stats.syncedProductCount > 0 && isTryOnEnabled(me);
  const routingDone = me.store.settings.onboardingRoutingConfirmed ?? false;
  const themeDone = me.store.settings.themeBlockConfirmed ?? false;

  // Intro is shown only on a genuinely fresh install (nothing started yet).
  // As soon as anything is started, skip intro and show the first incomplete step.
  const anythingStarted = me.stats.syncedProductCount > 0 || routingDone || themeDone;
  if (!anythingStarted) return 'intro';

  if (!productsDone) return 'products';
  if (!routingDone) return 'routing';
  if (!themeDone) return 'theme';
  return null;
}

/** The route for a given step; null (onboarding complete) routes to the app root. */
export function onboardingPath(step: OnboardingStep | null): string {
  if (step === null) return '/';
  if (step === 'intro') return '/onboarding';
  return `/onboarding/${step}`;
}
