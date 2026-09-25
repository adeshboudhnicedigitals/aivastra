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

/** The wizard's pages, in order. Contact and limits are not part of the derived step. */
export type OnboardingPage = 'intro' | 'products' | 'contact' | 'limits' | 'theme';

const PAGE_ORDER: OnboardingPage[] = ['intro', 'products', 'contact', 'limits', 'theme'];

/**
 * How far through getting started the merchant is, as a 0–1 fraction for the
 * footer's progress bar. It follows the page they are on: each page reads as
 * "you are here" (page N of the wizard), out of one more than the number of
 * pages, so the bar can only reach full when setup is genuinely finished — the
 * last page sits at 5/6 until the app embed is detected.
 *
 * Page 2 has two stages, so it moves a little within its slot as products are
 * picked (half a page) and then every basket is assigned (three quarters).
 */
export function getOnboardingProgress(me: ShopifyMe, page: OnboardingPage): number {
  const slots = PAGE_ORDER.length + 1;
  if (page === 'theme' && (me.store.settings.themeEmbedConfirmed ?? false)) return 1;

  let position = PAGE_ORDER.indexOf(page) + 1;
  if (page === 'products') {
    if (isBasketsDone(me)) position += 0.75;
    else if (isSelectionDone(me)) position += 0.5;
  }
  return position / slots;
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
