import type { ShopifyMe } from '../types';

export type OnboardingStep = 'intro' | 'theme';
// Product sync starts from the welcome page and runs in the background, so no
// step waits on it. Synced products only tell a returning merchant where to
// resume: with some, they have been through the first screens.
export function getOnboardingStep(me: ShopifyMe): OnboardingStep | null {
  const themeDone =
    (me.store.settings.themeBlockConfirmed ?? false) ||
    (me.store.settings.themeStepSkipped ?? false);
  if (themeDone) return null;
  return me.stats.syncedProductCount > 0 ? 'theme' : 'intro';
}
export type OnboardingPage = 'intro' | 'contact' | 'limits' | 'theme';
export const PAGE_ORDER: OnboardingPage[] = ['intro', 'contact', 'limits', 'theme'];
export type StepPage = Exclude<OnboardingPage, 'intro'>;
export const STEP_PAGES = PAGE_ORDER.filter((p): p is StepPage => p !== 'intro');
// Names shown in the step row and on the "Continue to ..." button.
export const STEP_LABELS: Record<StepPage, string> = {
  contact: 'Contact Details',
  limits: 'Customize Widget',
  theme: 'Activate Storefront',
};
export function nextStepLabel(page: OnboardingPage): string | null {
  const next = PAGE_ORDER[PAGE_ORDER.indexOf(page) + 1];
  return next && next !== 'intro' ? STEP_LABELS[next] : null;
}
export function previousPagePath(page: OnboardingPage): string | null {
  const previous = PAGE_ORDER[PAGE_ORDER.indexOf(page) - 1];
  if (!previous) return null;
  return previous === 'intro' ? '/onboarding' : `/onboarding/${previous}`;
}
export function onboardingPath(step: OnboardingStep | null): string {
  if (step === null) return '/';
  if (step === 'intro') return '/onboarding';
  return `/onboarding/${step}`;
}
export function isTryOnOff(me: ShopifyMe): boolean {
  return me.stats.enabledProductCount === 0;
}
