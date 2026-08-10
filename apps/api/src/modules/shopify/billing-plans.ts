/**
 * Plan names as configured in Partner Dashboard for Shopify App Pricing.
 *
 * The Admin API's `AppSubscription` exposes only `name` — the plan's display
 * name — not a machine handle, so these strings are load-bearing across two
 * systems that don't type-check against each other: Partner Dashboard and this
 * file. Rename a plan in one without the other and credit grants silently stop.
 * If a plan is renamed, update both places in the same change.
 *
 * Matching is case-insensitive (see `normalizePlanName`) because we don't
 * control the capitalization Shopify echoes back for a dashboard-configured
 * plan. It is NOT fuzzy beyond that: an unrecognized name maps to null and
 * grants nothing rather than guessing which tier the merchant paid for.
 *
 * Draft launch prices (set in Partner Dashboard, not here — this file only
 * owns credits, never price): starter $29, growth $59, pro $229/month.
 */
export const SHOPIFY_PLAN_HANDLES = ['starter', 'growth', 'pro'] as const;
export type ShopifyPlanHandle = (typeof SHOPIFY_PLAN_HANDLES)[number];

const CREDITS_BY_PLAN_HANDLE: Record<ShopifyPlanHandle, number> = {
  starter: 1925,
  growth: 5000,
  pro: 22000,
};

/**
 * Canonical form of a Shopify plan name: trimmed and lowercased. This is what
 * gets persisted to `shopify_stores.plan_handle`, so "Starter", "STARTER" and
 * " starter " all store — and display — identically.
 */
export function normalizePlanName(name: string): string {
  return name.trim().toLowerCase();
}

/** Credits granted per billing cycle, or null when the name is not a plan we know. */
export function creditsForPlanName(name: string): number | null {
  return (CREDITS_BY_PLAN_HANDLE as Record<string, number>)[normalizePlanName(name)] ?? null;
}
