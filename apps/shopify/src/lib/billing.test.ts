import { describe, expect, it } from 'vitest';
import { buildPlanSelectionUrl, resolvePlanSelectionUrl } from './billing';

describe('buildPlanSelectionUrl', () => {
  it('strips .myshopify.com and builds the hosted pricing page URL', () => {
    expect(buildPlanSelectionUrl('cool-shop.myshopify.com', 'aivastra')).toBe(
      'https://admin.shopify.com/store/cool-shop/charges/aivastra/pricing_plans',
    );
  });
});

describe('resolvePlanSelectionUrl', () => {
  it('returns the hosted pricing page URL when an app handle is present', () => {
    expect(resolvePlanSelectionUrl('cool-shop.myshopify.com', 'aivastra')).toEqual({
      url: 'https://admin.shopify.com/store/cool-shop/charges/aivastra/pricing_plans',
    });
  });

  it('returns an error instead of a dead-end URL when the app handle is missing', () => {
    expect(resolvePlanSelectionUrl('cool-shop.myshopify.com', '')).toEqual({
      error:
        'Plan selection is unavailable — this build is missing its Shopify app handle. Contact support@aivastra.com.',
    });
  });
});
