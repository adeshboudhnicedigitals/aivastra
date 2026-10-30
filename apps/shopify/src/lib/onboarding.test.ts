import { describe, expect, it } from 'vitest';
import type { ShopifyMe } from '../types';
import {
  canShowPostProductsPage,
  canShowProductsPage,
  getOnboardingStep,
  isProductsDone,
} from './onboarding';

function me(syncedProductCount: number, themeBlockConfirmed = false): ShopifyMe {
  return {
    store: {
      shopDomain: 'test.myshopify.com',
      shopOwnerName: null,
      shopPhone: null,
      shopEmail: null,
      settings: { themeBlockConfirmed },
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

describe('single-workflow onboarding steps', () => {
  it('shows intro for a fresh store', () => expect(getOnboardingStep(me(0))).toBe('intro'));
  it('moves synced stores to theme until the theme is confirmed', () =>
    expect(getOnboardingStep(me(2))).toBe('theme'));
  it('completes when products and theme are done', () =>
    expect(getOnboardingStep(me(2, true))).toBeNull());
  it('shows products when theme is confirmed but nothing is synced', () =>
    expect(getOnboardingStep(me(0, true))).toBe('products'));
  it('derives product completion only from synced count', () =>
    expect(isProductsDone(me(1))).toBe(true));
  it('allows the products page for intro, products and theme', () => {
    expect(canShowProductsPage('intro')).toBe(true);
    expect(canShowProductsPage('products')).toBe(true);
    expect(canShowProductsPage('theme')).toBe(true);
    expect(canShowProductsPage(null)).toBe(false);
  });
  it('allows post-products pages only after products', () => {
    expect(canShowPostProductsPage('theme')).toBe(true);
    expect(canShowPostProductsPage(null)).toBe(true);
    expect(canShowPostProductsPage('products')).toBe(false);
  });
});
