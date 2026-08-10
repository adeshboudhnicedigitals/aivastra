/**
 * Plan handles as configured in Partner Dashboard for Shopify App Pricing.
 * These strings are load-bearing across two systems that don't type-check
 * against each other — Partner Dashboard and this file — so a handle rename
 * in one without the other silently breaks credit grants. If a plan is
 * renamed, update both places in the same change.
 *
 * Draft launch prices (set in Partner Dashboard, not here — this file only
 * owns credits, never price): starter $29, growth $59, pro $219/month.
 */
export const SHOPIFY_PLAN_HANDLES = ['starter', 'growth', 'pro'] as const;
export type ShopifyPlanHandle = (typeof SHOPIFY_PLAN_HANDLES)[number];

const CREDITS_BY_PLAN_HANDLE: Record<ShopifyPlanHandle, number> = {
  starter: 2500,
  growth: 6250,
  pro: 25000,
};

export function creditsForPlanHandle(handle: string): number | null {
  return (CREDITS_BY_PLAN_HANDLE as Record<string, number>)[handle] ?? null;
}
