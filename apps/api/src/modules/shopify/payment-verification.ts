import { schema } from '@aivastra/db';
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { numericChargeId } from './partner-api.js';
import { fetchSalesForRows, type SalesFetchOptions } from './payment-settlement.js';

type PurchaseRow = typeof schema.shopifyCreditPurchases.$inferSelect;

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

export interface VerifyOptions extends SalesFetchOptions {
  /** Defaults to verifyWindowMs(app.env). */
  windowMs?: number;
  /**
   * Called from the per-row catch, alongside the log, so a single-row caller (the
   * admin action) can re-raise a failure this function otherwise swallows to
   * protect a batch.
   */
  onRowError?: (row: PurchaseRow, err: unknown) => void;
}

/**
 * One Partner API query for all `rows`, then confirm / re-schedule / flag each.
 *
 * - sale found -> PAID with the sale's time. NEVER grants: the credits were given
 *   at approval, so this only records what Shopify did.
 * - no sale -> decideNoSale (stay UNVERIFIED inside the window, NOT_RECEIVED after).
 *
 * Throws PartnerApiError on any API failure WITHOUT touching a row: absence of a
 * sale only means something after a successful query, so a failed query must never
 * push a row toward NOT_RECEIVED. Every update is conditional on the row still
 * being an automatic UNVERIFIED/NOT_RECEIVED one, so a concurrent admin override
 * (source MANUAL) always wins.
 */
export async function verifyGrantedPurchases(
  app: FastifyInstance,
  rows: PurchaseRow[],
  opts: VerifyOptions = {},
): Promise<void> {
  const checkable = rows.filter((r) => r.shopifyChargeId);
  if (checkable.length === 0) return;

  const now = opts.now ?? new Date();
  const windowMs = opts.windowMs ?? verifyWindowMs(app.env);
  const sales = await fetchSalesForRows(app, checkable, opts);

  const P = schema.shopifyCreditPurchases;
  for (const row of checkable) {
    try {
      const sale = sales.get(numericChargeId(row.shopifyChargeId as string));
      const stillAutomatic = and(
        eq(P.id, row.id),
        inArray(P.paymentStatus, ['UNVERIFIED', 'NOT_RECEIVED']),
        eq(P.paymentStatusSource, 'AUTO'),
      );
      if (sale) {
        await app.db
          .update(P)
          .set({
            paymentStatus: 'PAID',
            paidAt: sale.paidAt,
            nextPaymentCheckAt: null,
            updatedAt: now,
          })
          .where(stillAutomatic);
        continue;
      }
      const decision = decideNoSale(row.createdAt, now, windowMs);
      await app.db
        .update(P)
        .set({
          paymentStatus: decision.status,
          nextPaymentCheckAt: decision.nextCheckAt,
          updatedAt: now,
        })
        .where(stillAutomatic);
    } catch (err) {
      // One row's DB failure must not abandon the rest of the batch.
      app.log.error({ err, purchaseId: row.id }, 'payment verification failed for purchase');
      opts.onRowError?.(row, err);
    }
  }
}
