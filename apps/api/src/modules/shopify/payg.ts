import { schema } from '@aivastra/db';
import { DEFAULT_PAYG_SPEND_CAP_USD_CENTS, PAYG_PRICE_PER_TRYON_USD_CENTS } from '@aivastra/types';
import { and, eq, gte, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../../lib/errors.js';

/** Must match the meter handle configured in Partner Dashboard exactly — case-sensitive. */
export const EVENT_HANDLE = 'tryon_generated';

export {
  DEFAULT_PAYG_SPEND_CAP_USD_CENTS,
  MIN_PAYG_SPEND_CAP_USD_CENTS,
  PAYG_PRICE_PER_TRYON_USD_CENTS,
} from '@aivastra/types';

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
 *
 * Also gates on subscriptionStatus === 'active': billingMode is set to
 * 'usage' purely from the plan *name* match in syncStoreSubscription,
 * independent of whether Shopify is actually billing this subscription. A
 * PENDING (merchant never approved the charge), FROZEN, or DECLINED
 * subscription still leaves billingMode as 'usage' — without this check a
 * merchant who never approves the PAYG charge could generate try-ons up to
 * the spend cap for free, indefinitely. Checked first since it's cheaper
 * than the spend-cap query and should fail fast.
 */
export async function checkPaygSpendCap(
  app: FastifyInstance,
  store: typeof schema.shopifyStores.$inferSelect,
): Promise<void> {
  if (store.subscriptionStatus !== 'active') {
    throw new AppError('SUBSCRIPTION_INACTIVE', 402, 'no active subscription');
  }
  const cap = store.paygSpendCapUsdCents ?? DEFAULT_PAYG_SPEND_CAP_USD_CENTS;
  const spent = await getPaygSpendThisCycleCents(app, store);
  if (spent + PAYG_PRICE_PER_TRYON_USD_CENTS > cap) {
    throw new AppError('PAYG_CAP_REACHED', 402, 'monthly spend cap reached');
  }
}
