import { describe, expect, it } from 'vitest';
import { buildPlanSelectionUrl } from './billing';

describe('buildPlanSelectionUrl', () => {
  it('strips .myshopify.com and builds the hosted pricing page URL', () => {
    expect(buildPlanSelectionUrl('cool-shop.myshopify.com', 'aivastra')).toBe(
      'https://admin.shopify.com/store/cool-shop/charges/aivastra/pricing_plans',
    );
  });
});
