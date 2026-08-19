import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { reportUsageEvent } from './app-events-client.js';

interface TickDeps {
  report?: (
    app: FastifyInstance,
    params: { shopifyShopId: number; jobId: string },
  ) => Promise<'reported' | 'failed'>;
}

/**
 * Reports every PENDING shopify_usage_events row to Shopify's App Events
 * API. Mirrors billing-scheduler.ts's runBillingSyncTick shape — one pass
 * over rows, continue past a single failure, no throw.
 */
export async function runUsageReportTick(app: FastifyInstance, deps: TickDeps = {}): Promise<void> {
  const report = deps.report ?? reportUsageEvent;

  const pending = await app.db
    .select({
      id: schema.shopifyUsageEvents.id,
      jobId: schema.shopifyUsageEvents.jobId,
      storeId: schema.shopifyUsageEvents.storeId,
      shopifyShopId: schema.shopifyStores.shopifyShopId,
      subscriptionIsTest: schema.shopifyStores.subscriptionIsTest,
    })
    .from(schema.shopifyUsageEvents)
    .innerJoin(schema.shopifyStores, eq(schema.shopifyStores.id, schema.shopifyUsageEvents.storeId))
    .where(eq(schema.shopifyUsageEvents.status, 'PENDING'));

  for (const row of pending) {
    // Mirrors syncStoreSubscription's SHOPIFY_ALLOW_TEST_SUBSCRIPTIONS gate:
    // a test-subscription store's usage rows exist (the job ran, cost real
    // GPU time) but must never be reported as real revenue in an environment
    // that doesn't allow it.
    if (row.subscriptionIsTest && app.env.SHOPIFY_ALLOW_TEST_SUBSCRIPTIONS !== true) {
      continue;
    }
    try {
      const result = await report(app, { shopifyShopId: row.shopifyShopId, jobId: row.jobId });
      if (result === 'reported') {
        await app.db
          .update(schema.shopifyUsageEvents)
          .set({ status: 'REPORTED', reportedAt: new Date() })
          .where(eq(schema.shopifyUsageEvents.id, row.id));
      }
    } catch (err) {
      app.log.error(
        { err, usageEventId: row.id },
        'PAYG usage event report failed — will retry next tick',
      );
    }
  }
}

const THREE_MINUTES_MS = 3 * 60 * 1000;

/** Call once after `app.listen(...)`, mirrors startBillingScheduler's shape exactly. */
export function startUsageScheduler(
  app: FastifyInstance,
  intervalMs: number = THREE_MINUTES_MS,
): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) {
      app.log.warn('usage report tick still running — skipping this interval');
      return;
    }
    running = true;
    void runUsageReportTick(app)
      .catch((err) => {
        app.log.error({ err }, 'usage report tick failed');
      })
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  return () => clearInterval(timer);
}
