import { schema } from '@aivastra/db';
import { shopifyPurchasesAwaitingPayment } from '@aivastra/observability';
import { and, asc, eq, isNotNull, lte, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { FetchOneTimeSales } from './partner-api.js';
import { checkPurchases } from './payment-settlement.js';

/** One tick settles at most this many purchases; the rest wait for the next minute. */
const BATCH = 200;
const ONE_MINUTE_MS = 60_000;

/**
 * One pass: settle every AWAITING purchase whose next check is due. Runs
 * regardless of SHOPIFY_HOLD_UNTIL_PAID, so turning the flag off still lets
 * rows already parked AWAITING settle.
 */
export async function runPaymentSettlementTick(
  app: FastifyInstance,
  opts: { fetchSales?: FetchOneTimeSales; now?: Date } = {},
): Promise<void> {
  const now = opts.now ?? new Date();
  const due = await app.db
    .select()
    .from(schema.shopifyCreditPurchases)
    .where(
      and(
        eq(schema.shopifyCreditPurchases.paymentStatus, 'AWAITING'),
        isNotNull(schema.shopifyCreditPurchases.shopifyChargeId),
        lte(schema.shopifyCreditPurchases.nextPaymentCheckAt, now),
      ),
    )
    .orderBy(asc(schema.shopifyCreditPurchases.nextPaymentCheckAt))
    .limit(BATCH);

  if (due.length > 0) {
    try {
      await checkPurchases(app, due, { fetchSales: opts.fetchSales, now });
    } catch (err) {
      // Fail closed: rows stay AWAITING and are retried next tick. Logged every
      // tick on purpose — with shopify_payment_check_last_success_timestamp
      // going stale, this is the alert.
      app.log.error(
        { err, due: due.length },
        'payment settlement check failed — purchases stay pending',
      );
    }
  }

  const [{ awaiting }] = await app.db
    .select({ awaiting: sql<number>`count(*)::int` })
    .from(schema.shopifyCreditPurchases)
    .where(eq(schema.shopifyCreditPurchases.paymentStatus, 'AWAITING'));
  shopifyPurchasesAwaitingPayment.set(awaiting);
}

/** Call once after `app.listen(...)`. */
export function startPaymentSettlementScheduler(
  app: FastifyInstance,
  intervalMs: number = ONE_MINUTE_MS,
): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) {
      app.log.warn('payment settlement tick still running — skipping this interval');
      return;
    }
    running = true;
    void runPaymentSettlementTick(app)
      .catch((err) => {
        app.log.error({ err }, 'payment settlement tick failed');
      })
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  return () => clearInterval(timer);
}
