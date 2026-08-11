import { schema } from '@aivastra/db';
import { isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { syncStoreSubscription } from './billing.js';

// Admin GraphQL rate limits are per-shop, so N stores in a tick do not share a
// budget and no fixed pacing is strictly required. This small delay is only to
// keep a large install base from opening every outbound request at once (and to
// keep the log burst smooth); it is not a correctness constraint.
const PER_STORE_DELAY_MS = 100;

interface TickDeps {
  sync?: typeof syncStoreSubscription;
  sleepImpl?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * One tick: re-sync every currently-installed store's Shopify App Pricing
 * subscription. This is the only mechanism that catches a renewal,
 * cancellation, or freeze that happens without the merchant visiting the
 * app — Shopify App Pricing sends no webhook for any of those (see billing.ts
 * for the full explanation).
 */
export async function runBillingSyncTick(app: FastifyInstance, deps: TickDeps = {}): Promise<void> {
  const sync = deps.sync ?? syncStoreSubscription;
  const sleepImpl = deps.sleepImpl ?? defaultSleep;

  const stores = await app.db
    .select()
    .from(schema.shopifyStores)
    .where(isNull(schema.shopifyStores.uninstalledAt));

  for (const store of stores) {
    try {
      await sync(app, store);
    } catch (err) {
      app.log.error({ err, storeId: store.id }, 'shopify billing sync failed for store');
    }
    await sleepImpl(PER_STORE_DELAY_MS);
  }
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * Call once after `app.listen(...)`, alongside startCollectionResyncScheduler
 * — mirrors that function's "start once, get a stop function back" shape.
 */
export function startBillingScheduler(
  app: FastifyInstance,
  intervalMs: number = HOUR_MS,
): () => void {
  // One tick makes a serialized Admin API round-trip per installed store, so at
  // a large enough install count it can outrun the interval. Without this guard
  // setInterval would stack ticks, multiplying outbound requests against every
  // shop and re-reading the same rows concurrently.
  let running = false;
  const timer = setInterval(() => {
    if (running) {
      app.log.warn('billing sync tick still running — skipping this interval');
      return;
    }
    running = true;
    void runBillingSyncTick(app)
      .catch((err) => {
        app.log.error({ err }, 'billing sync tick failed');
      })
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  return () => clearInterval(timer);
}
