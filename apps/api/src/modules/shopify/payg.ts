import { schema } from '@aivastra/db';
import { and, eq, gte, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../../lib/errors.js';

/**
 * The code-side mirror of the Partner Dashboard meter price. Must match it
 * exactly — this is what the spend cap is checked against, and if it drifts
 * from what Shopify actually bills, the cap stops meaning what it says. If
 * the Partner Dashboard price ever changes, this constant changes in the
 * same PR.
 */
export const PAYG_PRICE_PER_TRYON_USD_CENTS = 10;

/** Must match the meter handle configured in Partner Dashboard exactly — case-sensitive. */
export const EVENT_HANDLE = 'tryon_generated';

export const DEFAULT_PAYG_SPEND_CAP_USD_CENTS = 5000; // $50
export const MIN_PAYG_SPEND_CAP_USD_CENTS = 500; // $5

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The start of the current billing cycle window. Mirrors currentPeriodEnd's
 * role in syncStoreSubscription's isNewCycle check: usage from before this
 * point belongs to a previous cycle and must not count against the current
 * cap. Falls back to a rolling 30-day window when currentPeriodEnd hasn't
 * been synced yet (e.g. the very first tick after a store selects PAYG).
 */
export function cycleWindowStart(store: typeof schema.shopifyStores.$inferSelect): Date {
  if (store.currentPeriodEnd) {
    return new Date(store.currentPeriodEnd.getTime() - THIRTY_DAYS_MS);
  }
  return new Date(Date.now() - THIRTY_DAYS_MS);
}

/**
 * Sum of this-cycle shopify_usage_events for one store, in USD cents.
 * Includes both PENDING and REPORTED rows — a row not yet reported to
 * Shopify is still a real cost that already happened and must still count
 * against the cap; only the App Events call is deferred, not the spend.
 */
export async function getPaygSpendThisCycleCents(
  app: FastifyInstance,
  store: typeof schema.shopifyStores.$inferSelect,
): Promise<number> {
  const [row] = await app.db
    .select({
      total: sql<number>`COALESCE(SUM(${schema.shopifyUsageEvents.priceUsdCents}), 0)::int`,
    })
    .from(schema.shopifyUsageEvents)
    .where(
      and(
        eq(schema.shopifyUsageEvents.storeId, store.id),
        gte(schema.shopifyUsageEvents.createdAt, cycleWindowStart(store)),
      ),
    );
  return row?.total ?? 0;
}

/**
 * Throws PAYG_CAP_REACHED (402) if dispatching one more try-on would meet or
 * exceed the store's spend cap. Checked against the local running total, not
 * a live Shopify read — a per-job GraphQL round trip before every dispatch
 * isn't worth the latency, same reasoning as why credits are checked locally
 * today. Accurate to within reporting lag, not to the millisecond.
 */
export async function checkPaygSpendCap(
  app: FastifyInstance,
  store: typeof schema.shopifyStores.$inferSelect,
): Promise<void> {
  const cap = store.paygSpendCapUsdCents ?? DEFAULT_PAYG_SPEND_CAP_USD_CENTS;
  const spent = await getPaygSpendThisCycleCents(app, store);
  if (spent + PAYG_PRICE_PER_TRYON_USD_CENTS > cap) {
    throw new AppError('PAYG_CAP_REACHED', 402, 'monthly spend cap reached');
  }
}
