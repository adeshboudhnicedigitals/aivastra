import { describe, expect, it } from 'vitest';
import { PLAN_FEATURE_SETS, SHARED_FEATURE_BULLETS } from './planFeatures';

describe('PLAN_FEATURE_SETS', () => {
  it('lists exactly starter, growth, pro in that order', () => {
    expect(PLAN_FEATURE_SETS.map((p) => p.handle)).toEqual(['starter', 'growth', 'pro']);
  });

  it('matches the pricing sheet for each tier', () => {
    const [starter, growth, pro] = PLAN_FEATURE_SETS;
    expect(starter).toMatchObject({
      priceUsd: 29,
      credits: 1925,
      virtualTryOns: 385,
      analyticsTier: 'Basic',
      customBranding: false,
      whiteLabel: false,
      support: 'Email',
    });
    expect(growth).toMatchObject({
      priceUsd: 59,
      credits: 5000,
      virtualTryOns: 1000,
      analyticsTier: 'Advanced',
      customBranding: true,
      whiteLabel: false,
      support: 'Priority Email',
      bestValue: true,
    });
    expect(pro).toMatchObject({
      priceUsd: 229,
      credits: 22000,
      virtualTryOns: 4400,
      analyticsTier: 'Advanced',
      customBranding: true,
      whiteLabel: true,
      support: 'Dedicated Support',
    });
  });
});

describe('SHARED_FEATURE_BULLETS', () => {
  it('lists the 10 features identical across every tier', () => {
    expect(SHARED_FEATURE_BULLETS).toEqual([
      'Unlimited products',
      'AI Virtual Try-On',
      'Outfit Builder',
      'Customer Photo Upload',
      'Shopify Integration',
      'Try-On Button',
      'Multiple Garment Categories',
      'Realistic AI Rendering',
      'Try-On History',
      'Mobile & Desktop Support',
    ]);
  });
});
