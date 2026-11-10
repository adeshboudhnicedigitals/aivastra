import { describe, expect, it } from 'vitest';
import type { ShopifyMe } from '../types';
import { getOnboardingStep } from './onboarding';

function me(
  syncedProductCount: number,
  themeBlockConfirmed = false,
  themeStepSkipped = false,
): ShopifyMe {
  return {
    store: {
      shopDomain: 'test.myshopify.com',
      shopOwnerName: null,
      shopPhone: null,
      shopEmail: null,
      settings: { themeBlockConfirmed, themeStepSkipped },
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
      syncedProductCount,
      enabledProductCount: syncedProductCount,
      statusCounts: { active: 0, processing: 0, failed: 0, disabled: 0 },
      todayTryOns: 0,
      storeDailyCap: null,
      capturedEmailCount: 0,
    },
  };
}

describe('onboarding steps', () => {
  it('shows intro for a fresh store', () => expect(getOnboardingStep(me(0))).toBe('intro'));
  it('resumes synced stores at theme until the theme is confirmed', () =>
    expect(getOnboardingStep(me(2))).toBe('theme'));
  it('completes once the theme is confirmed', () =>
    expect(getOnboardingStep(me(2, true))).toBeNull());
  it('does not wait for products: a store with none finishes when the theme is done', () =>
    expect(getOnboardingStep(me(0, true))).toBeNull());
});

describe('skipping the theme step', () => {
  it('ends onboarding when the step is skipped, without claiming the block is placed', () => {
    expect(getOnboardingStep(me(3, false, true))).toBeNull();
    expect(getOnboardingStep(me(3, false, false))).toBe('theme');
  });
});
