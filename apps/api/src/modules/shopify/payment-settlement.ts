import { type DB, type DbTransaction, schema } from '@aivastra/db';
import {
  shopifyPaymentCheckFailuresTotal,
  shopifyPaymentCheckLastSuccess,
} from '@aivastra/observability';
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { grantStore } from '../credits/shopify-ledger.js';
import {
  type FetchOneTimeSales,
  fetchOneTimeSales,
  numericChargeId,
  PartnerApiError,
} from './partner-api.js';

/**
 * Hold-until-paid settlement: turns an AWAITING purchase into PAID + credits
 * once the Partner API shows Shopify collected the money. Shared by the 60 s
 * loop, the merchant's confirm route and the admin "Check payment" action.
 * Spec: docs/superpowers/specs/2026-10-09-shopify-hold-until-paid-design.md.
 */

type PurchaseRow = typeof schema.shopifyCreditPurchases.$inferSelect;
export type PaymentStatus = 'NOT_REQUIRED' | 'AWAITING' | 'PAID' | 'UNPAID';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
export const PARK_AFTER_MS = 30 * DAY;

/** Slack on `since` so clock skew between us and Shopify can't hide a sale. */
const SINCE_SLACK_MS = HOUR;

/**
 * Backoff measured from the purchase's createdAt: most payments land within
 * minutes, a failed one may be paid days later from the merchant's billing
 * page. Returns null once the purchase is 30 days old — the caller parks it.
 */
export function nextCheckAt(createdAt: Date, now: Date): Date | null {
  const age = now.getTime() - createdAt.getTime();
  if (age >= PARK_AFTER_MS) return null;
  const step = age < 15 * MIN ? MIN : age < DAY ? 15 * MIN : age < 7 * DAY ? HOUR : DAY;
  return new Date(now.getTime() + step);
}

/**
 * Marks the purchase PAID and grants its snapshotted credits in ONE
 * transaction. The conditional UPDATE is the race guard: whichever of loop,
 * confirm or admin gets there first flips the row and grants; everyone else
 * gets zero rows back and grants nothing. grantStore's external_ref
 * idempotency stays underneath as the second guard.
 */
export async function settlePaid(
  db: DB,
  row: PurchaseRow,
  paidAt: Date,
  onSettled?: (tx: DbTransaction, row: PurchaseRow) => Promise<void>,
): Promise<boolean> {
  if (!row.shopifyChargeId) return false;
  const chargeId = row.shopifyChargeId;
  return db.transaction(async (tx) => {
    const flipped = await tx
      .update(schema.shopifyCreditPurchases)
      .set({ paymentStatus: 'PAID', paidAt, nextPaymentCheckAt: null, updatedAt: new Date() })
      .where(
        and(
          eq(schema.shopifyCreditPurchases.id, row.id),
          inArray(schema.shopifyCreditPurchases.paymentStatus, ['AWAITING', 'UNPAID']),
        ),
      )
      .returning({ id: schema.shopifyCreditPurchases.id });
    if (flipped.length === 0) return false;

    // Same reason and ref the grant-on-ACTIVE path always used, so a purchase
    // reads identically in the ledger whichever path granted it.
    await grantStore(
      tx as never,
      row.storeId,
      row.credits,
      'SHOPIFY_PACK',
      `shopify_pack:${chargeId}`,
    );
    if (onSettled) await onSettled(tx as never, row);
    return true;
  });
}

export interface CheckOptions {
  /** Narrows the Partner API query to one store — used by single-purchase checks. */
  shop?: string;
  fetchSales?: FetchOneTimeSales;
  now?: Date;
  onSettled?: (tx: DbTransaction, row: PurchaseRow) => Promise<void>;
  /**
   * Called from the per-row catch, alongside the log. Single-row callers (the
   * admin action) use it to re-raise a failure that this function otherwise
   * swallows to protect a batch.
   */
  onRowError?: (row: PurchaseRow, err: unknown) => void;
}

/**
 * One Partner API query for all `rows`, then settle / reschedule / park each.
 * Throws PartnerApiError on any API failure WITHOUT touching a row — fail
 * closed: our outage must never grant, park, or push a check later.
 */
export async function checkPurchases(
  app: FastifyInstance,
  rows: PurchaseRow[],
  opts: CheckOptions = {},
): Promise<Map<string, PaymentStatus>> {
  const outcome = new Map<string, PaymentStatus>();
  const checkable = rows.filter((r) => r.shopifyChargeId);
  if (checkable.length === 0) return outcome;

  const now = opts.now ?? new Date();
  const fetchSales = opts.fetchSales ?? fetchOneTimeSales;
  const oldest = Math.min(...checkable.map((r) => r.createdAt.getTime()));

  let sales: Awaited<ReturnType<FetchOneTimeSales>>;
  try {
    sales = await fetchSales(app.env, {
      since: new Date(oldest - SINCE_SLACK_MS),
      shop: opts.shop,
    });
  } catch (err) {
    const reason = err instanceof PartnerApiError ? err.reason : 'http';
    shopifyPaymentCheckFailuresTotal.inc({ reason });
    throw err instanceof PartnerApiError ? err : new PartnerApiError('http', String(err));
  }
  shopifyPaymentCheckLastSuccess.set(Math.floor(now.getTime() / 1000));

  for (const row of checkable) {
    try {
      const sale = sales.get(numericChargeId(row.shopifyChargeId as string));
      if (sale) {
        await settlePaid(app.db, row, sale.paidAt, opts.onSettled);
        outcome.set(row.id, 'PAID');
        continue;
      }
      // An UNPAID row stays UNPAID until a sale appears — no rescheduling.
      if (row.paymentStatus === 'UNPAID') {
        outcome.set(row.id, 'UNPAID');
        continue;
      }
      const next = nextCheckAt(row.createdAt, now);
      await app.db
        .update(schema.shopifyCreditPurchases)
        .set(
          next
            ? { nextPaymentCheckAt: next, updatedAt: now }
            : { paymentStatus: 'UNPAID', nextPaymentCheckAt: null, updatedAt: now },
        )
        .where(
          and(
            eq(schema.shopifyCreditPurchases.id, row.id),
            eq(schema.shopifyCreditPurchases.paymentStatus, 'AWAITING'),
          ),
        );
      outcome.set(row.id, next ? 'AWAITING' : 'UNPAID');
    } catch (err) {
      // One row's DB failure must not abandon the rest of the batch.
      app.log.error({ err, purchaseId: row.id }, 'payment settlement failed for purchase');
      opts.onRowError?.(row, err);
    }
  }
  return outcome;
}
