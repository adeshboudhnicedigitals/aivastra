import { describe, expect, it } from 'vitest';
import type { ShopifyMe } from '../types';

import { getOnboardingStep, onboardingPath } from './onboarding';

function baseMe(
  overrides: {
    syncedProductCount?: number;
    enabledProductCount?: number;
    activationMode?: 'global' | 'selective';
    onboardingRoutingConfirmed?: boolean;
    themeBlockConfirmed?: boolean;
  } = {},
): ShopifyMe {
  return {
    store: {
      shopDomain: 'test.myshopify.com',
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

  it('returns routing once products are synced and enabled globally', () => {
    const me = baseMe({ syncedProductCount: 5, activationMode: 'global' });
    expect(getOnboardingStep(me)).toBe('routing');
  });

  it('returns routing once products are synced and at least one is individually enabled (selective mode)', () => {
    const me = baseMe({
      syncedProductCount: 5,
      enabledProductCount: 1,
      activationMode: 'selective',
    });
    expect(getOnboardingStep(me)).toBe('routing');
  });

  it('stays on products if synced but nothing is enabled', () => {
    const me = baseMe({
      syncedProductCount: 5,
      enabledProductCount: 0,
      activationMode: 'selective',
    });
    expect(getOnboardingStep(me)).toBe('products');
  });

  it('returns theme once products and routing are both done', () => {
    const me = baseMe({
      syncedProductCount: 5,
      activationMode: 'global',
      onboardingRoutingConfirmed: true,
    });
    expect(getOnboardingStep(me)).toBe('theme');
  });

  it('returns null once all three steps are done', () => {
    const me = baseMe({
      syncedProductCount: 5,
      activationMode: 'global',
      onboardingRoutingConfirmed: true,
      themeBlockConfirmed: true,
    });
    expect(getOnboardingStep(me)).toBeNull();
  });

  it('skips the intro and jumps straight to the first incomplete step for a store with pre-existing partial progress (e.g. theme confirmed under the old checklist, before this wizard existed, but never synced)', () => {
    const me = baseMe({ themeBlockConfirmed: true });
    expect(getOnboardingStep(me)).toBe('products');
  });
});

describe('onboardingPath', () => {
  it('maps intro to /onboarding', () => {
    expect(onboardingPath('intro')).toBe('/onboarding');
  });

  it('maps products/routing/theme to their own sub-route', () => {
    expect(onboardingPath('products')).toBe('/onboarding/products');
    expect(onboardingPath('routing')).toBe('/onboarding/routing');
    expect(onboardingPath('theme')).toBe('/onboarding/theme');
  });

  it('maps null (complete) to the app root', () => {
    expect(onboardingPath(null)).toBe('/');
  });
});
