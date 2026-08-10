export interface PlanFeatureSet {
  handle: 'starter' | 'growth' | 'pro';
  label: string;
  bestValue?: boolean;
  priceUsd: number;
  credits: number;
  virtualTryOns: number;
  analyticsTier: 'Basic' | 'Advanced';
  customBranding: boolean;
  whiteLabel: boolean;
  support: string;
}

// Mirrors shopify-packages.pdf. Display copy only — the credit-granting
// source of truth is apps/api/src/modules/shopify/billing-plans.ts, kept
// deliberately separate so a copy change here can't silently change what a
// merchant is actually granted.
export const PLAN_FEATURE_SETS: PlanFeatureSet[] = [
  {
    handle: 'starter',
    label: 'Starter',
    priceUsd: 29,
    credits: 1925,
    virtualTryOns: 385,
    analyticsTier: 'Basic',
    customBranding: false,
    whiteLabel: false,
    support: 'Email',
  },
  {
    handle: 'growth',
    label: 'Growth',
    bestValue: true,
    priceUsd: 59,
    credits: 5000,
    virtualTryOns: 1000,
    analyticsTier: 'Advanced',
    customBranding: true,
    whiteLabel: false,
    support: 'Priority Email',
  },
  {
    handle: 'pro',
    label: 'Pro',
    priceUsd: 229,
    credits: 22000,
    virtualTryOns: 4400,
    analyticsTier: 'Advanced',
    customBranding: true,
    whiteLabel: true,
    support: 'Dedicated Support',
  },
];

// Identical across every tier per the pricing sheet — rendered once per
// column rather than as a per-tier boolean.
export const SHARED_FEATURE_BULLETS = [
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
];
