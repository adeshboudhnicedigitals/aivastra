import type { ShopifyMe } from '../types';

export type OnboardingStep = 'intro' | 'products' | 'theme';

/**
 * Something is enabled: the store has synced products and either global mode is
 * on or at least one product is individually enabled. `enabledProductCount`
 * only counts products that resolve to a basket, so the unrouted ones are added
 * back — a product the merchant just picked but has not given a basket yet
 * still counts as picked. `unroutedEnabledCount` is null when the API skipped
 * the routing scan for a very large catalogue; that is treated as zero.
 */
export function isSelectionDone(me: ShopifyMe): boolean {
  const { syncedProductCount, enabledProductCount, unroutedEnabledCount } = me.stats;
  const globalModeOn = me.store.settings.activation?.mode === 'global';
  return (
    syncedProductCount > 0 &&
    (globalModeOn || enabledProductCount + (unroutedEnabledCount ?? 0) > 0)
  );
}

/**
 * Every enabled product resolves to a basket. Derived from live data rather than
 * a stored flag — without a basket a product simply refuses try-on, so "the
 * merchant clicked Continue" is the wrong signal here.
 */
export function isBasketsDone(me: ShopifyMe): boolean {
  return (
    isSelectionDone(me) &&
    (me.stats.unroutedEnabledCount ?? 0) === 0 &&
    me.stats.enabledProductCount > 0
  );
}

/**
 * The wizard's current step, or null once every step is done. 'products' covers
 * both stages of page 2 (pick products, then pick baskets); which stage shows is
 * decided by isSelectionDone on that page. Intro has no flag of its own — it is
 * shown only on a genuinely fresh install (nothing synced, theme block not
 * confirmed); as soon as anything is started, a merchant resuming the wizard
 * jumps to the first incomplete step.
 */
export function getOnboardingStep(me: ShopifyMe): OnboardingStep | null {
  const themeDone = me.store.settings.themeBlockConfirmed ?? false;
  const anythingStarted = me.stats.syncedProductCount > 0 || themeDone;
  if (!anythingStarted) return 'intro';

  if (!isBasketsDone(me)) return 'products';
  if (!themeDone) return 'theme';
  return null;
}

/**
 * The wizard's pages, in order. Contact and limits are not part of the derived
 * step. Exported so the shell's numbered step header can render "you are here"
 * without duplicating this order. The intro is a welcome screen, not a step:
 * numbering starts at the products page (see STEP_PAGES).
 */
export type OnboardingPage = 'intro' | 'products' | 'contact' | 'limits' | 'theme';

export const PAGE_ORDER: OnboardingPage[] = ['intro', 'products', 'contact', 'limits', 'theme'];

/** The pages that count as numbered steps: everything after the welcome intro. */
export type StepPage = Exclude<OnboardingPage, 'intro'>;
export const STEP_PAGES = PAGE_ORDER.filter((p): p is StepPage => p !== 'intro');

/** The route of the page before this one in the wizard; null on the first page. */
export function previousPagePath(page: OnboardingPage): string | null {
  const previous = PAGE_ORDER[PAGE_ORDER.indexOf(page) - 1];
  if (!previous) return null;
  return previous === 'intro' ? '/onboarding' : `/onboarding/${previous}`;
}

/** The route for a given step; null (onboarding complete) routes to the app root. */
export function onboardingPath(step: OnboardingStep | null): string {
  if (step === null) return '/';
  if (step === 'intro') return '/onboarding';
  return `/onboarding/${step}`;
}

/**
 * Whether the products page may render for this step. 'intro' is allowed
 * because arriving from the intro page's Continue is legitimate while nothing
 * has synced yet. 'theme' is allowed once a selection exists: finishing the
 * baskets flips the derived step to 'theme' at once, but the merchant should
 * stay on stage 2 (to review or override baskets) until they press Continue.
 */
export function canShowProductsPage(step: OnboardingStep | null, me: ShopifyMe): boolean {
  if (step === 'intro' || step === 'products') return true;
  if (step === 'theme') return isSelectionDone(me);
  return false;
}

/**
 * Whether the theme page may render for this step. Detecting the app embed
 * finishes the last step (getOnboardingStep goes from 'theme' to null), but the
 * merchant should see the "detected" state and press Continue themselves, so a
 * finished wizard keeps the page up instead of bouncing them to the dashboard.
 * Earlier steps still redirect back to where they left off.
 */
export function canShowThemePage(step: OnboardingStep | null): boolean {
  return step === 'theme' || step === null;
}

/**
 * Whether one of the pages between the baskets and the theme embed (contact,
 * shopper limits) may render. They sit after the baskets, so they are reachable
 * once the derived step has reached 'theme' (or the wizard is done); anything
 * earlier goes back to where the merchant left off.
 */
export function canShowPostBasketPage(step: OnboardingStep | null): boolean {
  return step === 'theme' || step === null;
}

/**
 * Try-on is effectively off for the whole store: no enabled product resolves
 * to a basket. `enabledProductCount` already means "enabled AND routed".
 */
export function isTryOnOff(me: ShopifyMe): boolean {
  return me.stats.enabledProductCount === 0;
}

/**
 * A store that finished onboarding while the try-on button was still an app
 * block: it confirmed the theme step but never switched the app embed on, so its
 * storefront button is gone until it does. New stores confirm both together on
 * the theme page, so this stays false for them.
 */
export function needsEmbedEnable(me: ShopifyMe): boolean {
  const { themeBlockConfirmed, themeEmbedConfirmed } = me.store.settings;
  return (themeBlockConfirmed ?? false) && !(themeEmbedConfirmed ?? false);
}

/**
 * Enabled products that refuse try-on for lack of a basket, for a dashboard
 * warning. Zero while nothing is live (isTryOnOff covers that case) and when the
 * routing scan was skipped for a very large catalogue (null).
 */
export function unroutedWarningCount(me: ShopifyMe): number {
  if (isTryOnOff(me)) return 0;
  return me.stats.unroutedEnabledCount ?? 0;
}
