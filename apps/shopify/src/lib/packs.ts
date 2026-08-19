// Display copy only. The credit-granting source of truth is
// apps/api/src/modules/shopify/packs.ts, kept deliberately separate so a copy
// change here can never silently change what a merchant is actually granted.
// If these numbers drift from the API's, the API wins, and the merchant sees
// the API's figure in their balance.
export interface PackDisplay {
  id: 'pack_10' | 'pack_25' | 'pack_50' | 'pack_100';
  label: string;
  priceUsd: number;
  credits: number;
  tryOns: number;
  bestValue?: boolean;
}

export const PACK_DISPLAY: PackDisplay[] = [
  { id: 'pack_10', label: 'Starter', priceUsd: 10, credits: 800, tryOns: 160 },
  { id: 'pack_25', label: 'Growth', priceUsd: 25, credits: 2250, tryOns: 450, bestValue: true },
  { id: 'pack_50', label: 'Scale', priceUsd: 50, credits: 4800, tryOns: 960 },
  { id: 'pack_100', label: 'Volume', priceUsd: 100, credits: 10000, tryOns: 2000 },
];

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

/**
 * Credits never expire, so this is the merchant's whole runway, not a monthly
 * allowance. The divisor is the compile-time default try-on cost, not the
 * live admin-tunable value (tryon.creditCost) — this SPA has no endpoint that
 * exposes that live number today, so this figure can drift from the API's
 * if an admin retunes the cost. The API-side charge name shown to the
 * merchant at purchase time (apps/api/src/modules/shopify/purchase.ts) does
 * use the live value and is the one that's actually money-relevant.
 */
export function tryOnsFromCredits(credits: number): number {
  return Math.floor(credits / 5);
}
