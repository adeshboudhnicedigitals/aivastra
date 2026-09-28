import { describe, expect, it } from 'vitest';
import type { ShopifyMe } from '../types';

import {
  canShowPostBasketPage,
  canShowProductsPage,
  canShowThemePage,
  getOnboardingStep,
  isBasketsDone,
  isSelectionDone,
  isTryOnOff,
  needsEmbedEnable,
  onboardingPath,
  previousPagePath,
  unroutedWarningCount,
} from './onboarding';

function baseMe(
  overrides: {
    syncedProductCount?: number;
    enabledProductCount?: number;
    unroutedEnabledCount?: number | null;
    activationMode?: 'global' | 'selective';
    onboardingRoutingConfirmed?: boolean;
    themeBlockConfirmed?: boolean;
  } = {},
): ShopifyMe {
  return {
    store: {
      shopDomain: 'test.myshopify.com',
      shopOwnerName: null,
      shopPhone: null,
      shopEmail: null,
      settings: {
        activation: overrides.activationMode ? { mode: overrides.activationMode } : undefined,
        onboardingRoutingConfirmed: overrides.onboardingRoutingConfirmed,
        themeBlockConfirmed: overrides.themeBlockConfirmed,
      },
      connectedSince: '2026-01-01T00:00:00Z',
    },
    creditBalance: 0,
    hasPurchasedPack: false,
    currentPack: null,
    runway: {
      balance: 0,
      tryOnsRemaining: 0,
      dailyBurnCredits: 0,
      daysRemaining: null,
      level: 'ok',
    },
    autorefill: {
      enabled: false,
      status: null,
      packId: null,
      triggerCredits: null,
      cappedAmountUsdCents: null,
      balanceUsedUsdCents: null,
    },
    stats: {
      totalTryOns: 0,
      syncedProductCount: overrides.syncedProductCount ?? 0,
      enabledProductCount: overrides.enabledProductCount ?? 0,
      unroutedEnabledCount:
        overrides.unroutedEnabledCount === undefined ? 0 : overrides.unroutedEnabledCount,
      statusCounts: { active: 0, processing: 0, failed: 0, disabled: 0 },
      todayTryOns: 0,
      storeDailyCap: null,
      capturedEmailCount: 0,
    },
  };
}

describe('getOnboardingStep', () => {
  it('returns intro for a fresh install with nothing done', () => {
    expect(getOnboardingStep(baseMe())).toBe('intro');
  });

  it('stays on products while products are synced but none is enabled', () => {
    const me = baseMe({ syncedProductCount: 5, enabledProductCount: 0 });
    expect(getOnboardingStep(me)).toBe('products');
  });

  it('stays on products while an enabled product still has no basket', () => {
    const me = baseMe({ syncedProductCount: 5, enabledProductCount: 0, unroutedEnabledCount: 1 });
    expect(getOnboardingStep(me)).toBe('products');
  });

  it('stays on products when some enabled products are routed and some are not', () => {
    const me = baseMe({ syncedProductCount: 5, enabledProductCount: 2, unroutedEnabledCount: 1 });
    expect(getOnboardingStep(me)).toBe('products');
  });

  it('moves to theme once every enabled product has a basket', () => {
    const me = baseMe({ syncedProductCount: 5, enabledProductCount: 3, unroutedEnabledCount: 0 });
    expect(getOnboardingStep(me)).toBe('theme');
  });

  it('treats an omitted routing scan (null) as fully routed when something is routed', () => {
    const me = baseMe({
      syncedProductCount: 5,
      enabledProductCount: 3,
      unroutedEnabledCount: null,
    });
    expect(getOnboardingStep(me)).toBe('theme');
  });

  it('still needs a basket in global mode when every product is unrouted', () => {
    const me = baseMe({
      syncedProductCount: 5,
      activationMode: 'global',
      enabledProductCount: 0,
      unroutedEnabledCount: 5,
    });
    expect(getOnboardingStep(me)).toBe('products');
  });

  it('ignores the legacy onboardingRoutingConfirmed flag — routing is derived from live data now', () => {
    const me = baseMe({
      syncedProductCount: 5,
      enabledProductCount: 0,
      unroutedEnabledCount: 1,
      onboardingRoutingConfirmed: true,
    });
    expect(getOnboardingStep(me)).toBe('products');
  });

  it('returns null once products, baskets and the theme block are done', () => {
    const me = baseMe({
      syncedProductCount: 5,
      enabledProductCount: 3,
      themeBlockConfirmed: true,
    });
    expect(getOnboardingStep(me)).toBeNull();
  });

  it('skips the intro for a store that only ever confirmed the theme block (old checklist)', () => {
    expect(getOnboardingStep(baseMe({ themeBlockConfirmed: true }))).toBe('products');
  });
});

describe('isSelectionDone / isBasketsDone', () => {
  it('selection is done when something is enabled, routed or not', () => {
    expect(isSelectionDone(baseMe({ syncedProductCount: 5, unroutedEnabledCount: 2 }))).toBe(true);
    expect(isSelectionDone(baseMe({ syncedProductCount: 5, enabledProductCount: 1 }))).toBe(true);
    expect(isSelectionDone(baseMe({ syncedProductCount: 5 }))).toBe(false);
    expect(isSelectionDone(baseMe({ syncedProductCount: 0, enabledProductCount: 1 }))).toBe(false);
  });

  it('selection is done in global mode once anything is synced', () => {
    expect(isSelectionDone(baseMe({ syncedProductCount: 5, activationMode: 'global' }))).toBe(true);
  });

  it('baskets are done only when selection is done and nothing is unrouted', () => {
    expect(isBasketsDone(baseMe({ syncedProductCount: 5, enabledProductCount: 2 }))).toBe(true);
    expect(
      isBasketsDone(
        baseMe({ syncedProductCount: 5, enabledProductCount: 2, unroutedEnabledCount: 1 }),
      ),
    ).toBe(false);
    expect(isBasketsDone(baseMe({ syncedProductCount: 5 }))).toBe(false);
  });
});

describe('canShowProductsPage', () => {
  it('shows the page on the products step', () => {
    const me = baseMe({ syncedProductCount: 5, unroutedEnabledCount: 2 });
    expect(canShowProductsPage('products', me)).toBe(true);
  });

  it('shows the page while the derived step still says intro (arriving from the intro page)', () => {
    expect(canShowProductsPage('intro', baseMe())).toBe(true);
  });

  it('keeps stage 2 on screen once baskets are done, until the merchant presses Continue', () => {
    // Baskets done → getOnboardingStep says 'theme', but the page must not bounce.
    const me = baseMe({ syncedProductCount: 5, enabledProductCount: 3 });
    expect(getOnboardingStep(me)).toBe('theme');
    expect(canShowProductsPage('theme', me)).toBe(true);
  });

  it('rejects the theme step when nothing is selected', () => {
    expect(canShowProductsPage('theme', baseMe({ syncedProductCount: 5 }))).toBe(false);
  });

  it('rejects a finished wizard', () => {
    const me = baseMe({ syncedProductCount: 5, enabledProductCount: 3, themeBlockConfirmed: true });
    expect(canShowProductsPage(null, me)).toBe(false);
  });
});

describe('isTryOnOff / unroutedWarningCount', () => {
  it('try-on is off only when no enabled product resolves to a basket', () => {
    expect(isTryOnOff(baseMe({ syncedProductCount: 5 }))).toBe(true);
    expect(isTryOnOff(baseMe({ syncedProductCount: 5, unroutedEnabledCount: 4 }))).toBe(true);
    expect(
      isTryOnOff(
        baseMe({ syncedProductCount: 5, enabledProductCount: 1, unroutedEnabledCount: 4 }),
      ),
    ).toBe(false);
  });

  it('warns about unrouted products only while something is live', () => {
    expect(
      unroutedWarningCount(
        baseMe({ syncedProductCount: 5, enabledProductCount: 2, unroutedEnabledCount: 3 }),
      ),
    ).toBe(3);
    // Nothing live: the "try-on is off" banner already covers it.
    expect(unroutedWarningCount(baseMe({ syncedProductCount: 5, unroutedEnabledCount: 3 }))).toBe(
      0,
    );
    // Scan skipped for a huge catalogue.
    expect(
      unroutedWarningCount(
        baseMe({ syncedProductCount: 5, enabledProductCount: 2, unroutedEnabledCount: null }),
      ),
    ).toBe(0);
  });
});

describe('onboardingPath', () => {
  it('maps intro to /onboarding', () => {
    expect(onboardingPath('intro')).toBe('/onboarding');
  });

  it('maps products and theme to their own sub-route', () => {
    expect(onboardingPath('products')).toBe('/onboarding/products');
    expect(onboardingPath('theme')).toBe('/onboarding/theme');
  });

  it('maps null (complete) to the app root', () => {
    expect(onboardingPath(null)).toBe('/');
  });
});

describe('needsEmbedEnable', () => {
  it('flags a store that confirmed the old block but never enabled the embed', () => {
    expect(needsEmbedEnable(baseMe({ themeBlockConfirmed: true }))).toBe(true);
  });

  it('is false once the embed is confirmed, and for a store still mid-onboarding', () => {
    const confirmed = baseMe({ themeBlockConfirmed: true });
    confirmed.store.settings.themeEmbedConfirmed = true;
    expect(needsEmbedEnable(confirmed)).toBe(false);
    expect(needsEmbedEnable(baseMe())).toBe(false);
  });
});

describe('canShowThemePage', () => {
  it('stays up on the theme step and once the wizard is finished', () => {
    expect(canShowThemePage('theme')).toBe(true);
    expect(canShowThemePage(null)).toBe(true);
  });

  it('sends a merchant with earlier steps outstanding back to them', () => {
    expect(canShowThemePage('intro')).toBe(false);
    expect(canShowThemePage('products')).toBe(false);
  });
});

describe('canShowPostBasketPage', () => {
  it('opens once baskets are done, and stays available after the wizard finishes', () => {
    expect(canShowPostBasketPage('theme')).toBe(true);
    expect(canShowPostBasketPage(null)).toBe(true);
  });

  it('sends a merchant with products or baskets outstanding back to them', () => {
    expect(canShowPostBasketPage('intro')).toBe(false);
    expect(canShowPostBasketPage('products')).toBe(false);
  });
});

describe('previousPagePath', () => {
  it('steps back one page at a time, ending at the intro', () => {
    expect(previousPagePath('theme')).toBe('/onboarding/limits');
    expect(previousPagePath('limits')).toBe('/onboarding/contact');
    expect(previousPagePath('contact')).toBe('/onboarding/products');
    expect(previousPagePath('products')).toBe('/onboarding');
  });

  it('has nothing before the intro', () => {
    expect(previousPagePath('intro')).toBeNull();
  });
});
