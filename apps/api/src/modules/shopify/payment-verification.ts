/**
 * Grant-then-verify: credits are granted when the merchant approves the charge,
 * and the Partner API is used afterwards only to CONFIRM that Shopify collected
 * the money. A pack that is never confirmed is flagged for a human, not clawed
 * back. Spec: docs/superpowers/specs/2026-10-09-shopify-grant-then-verify-design.md.
 */

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

/** Delay before the first check after the grant. */
export const VERIFY_FIRST_CHECK_MS = 15 * MIN;
/** Re-check cadence while the purchase is inside the verification window. */
export const VERIFY_POLL_MS = 15 * MIN;
/** Re-check cadence once a purchase is NOT_RECEIVED (a late payer is caught the next day). */
export const NOT_RECEIVED_POLL_MS = DAY;
/** A NOT_RECEIVED purchase older than this is never re-checked automatically. */
export const NOT_RECEIVED_STOP_MS = 30 * DAY;

const DEFAULT_WINDOW_MINUTES = 180;
const MIN_WINDOW_MINUTES = 60;

/** The configured verification window in ms, falling back to the default for unset/too-small values. */
export function verifyWindowMs(env: { SHOPIFY_PAYMENT_VERIFY_WINDOW_MINUTES?: number }): number {
  const m = env.SHOPIFY_PAYMENT_VERIFY_WINDOW_MINUTES;
  return (typeof m === 'number' && m >= MIN_WINDOW_MINUTES ? m : DEFAULT_WINDOW_MINUTES) * MIN;
}

export interface NoSaleDecision {
  status: 'UNVERIFIED' | 'NOT_RECEIVED';
  /** null = never check this row again. */
  nextCheckAt: Date | null;
}

/**
 * What to do with a row for which a SUCCESSFUL Partner API query found no sale.
 * Only ever call this after a successful query: absence is meaningless if the
 * query failed, which is why a failed query must change nothing.
 */
export function decideNoSale(createdAt: Date, now: Date, windowMs: number): NoSaleDecision {
  const age = now.getTime() - createdAt.getTime();
  if (age < windowMs) {
    return { status: 'UNVERIFIED', nextCheckAt: new Date(now.getTime() + VERIFY_POLL_MS) };
  }
  if (age >= NOT_RECEIVED_STOP_MS) return { status: 'NOT_RECEIVED', nextCheckAt: null };
  return { status: 'NOT_RECEIVED', nextCheckAt: new Date(now.getTime() + NOT_RECEIVED_POLL_MS) };
}
