import type { ShopifyMe } from '../types';

export type OnboardingStep = 'intro' | 'products' | 'theme';
export function isProductsDone(me: ShopifyMe): boolean {
  return me.stats.syncedProductCount > 0;
}
export function getOnboardingStep(me: ShopifyMe): OnboardingStep | null {
  const themeDone = me.store.settings.themeBlockConfirmed ?? false;
  if (!isProductsDone(me) && !themeDone) return 'intro';
  if (!isProductsDone(me)) return 'products';
  if (!themeDone) return 'theme';
  return null;
}
export type OnboardingPage = 'intro' | 'products' | 'contact' | 'limits' | 'theme';
export const PAGE_ORDER: OnboardingPage[] = ['intro', 'products', 'contact', 'limits', 'theme'];
export type StepPage = Exclude<OnboardingPage, 'intro'>;
export const STEP_PAGES = PAGE_ORDER.filter((p): p is StepPage => p !== 'intro');
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
export function canShowProductsPage(step: OnboardingStep | null): boolean {
  return step === 'intro' || step === 'products' || step === 'theme';
}
export function canShowThemePage(step: OnboardingStep | null): boolean {
  return step === 'theme' || step === null;
}
export function canShowPostProductsPage(step: OnboardingStep | null): boolean {
  return step === 'theme' || step === null;
}
export function isTryOnOff(me: ShopifyMe): boolean {
  return me.stats.enabledProductCount === 0;
}
export function needsEmbedEnable(me: ShopifyMe): boolean {
  const { themeBlockConfirmed, themeEmbedConfirmed } = me.store.settings;
  return (themeBlockConfirmed ?? false) && !(themeEmbedConfirmed ?? false);
}
