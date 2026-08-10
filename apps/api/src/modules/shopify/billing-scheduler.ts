import { schema } from '@aivastra/db';
import { isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { syncStoreSubscription } from './billing.js';

// Partner API rate limit is 4 requests/second per client (per
// shopify.dev/docs/api/partner#rate-limits). One store = one request here, so
// a fixed delay between stores keeps a large store count from bursting past
// that even though today's install count is nowhere near it.
const PARTNER_API_MIN_DELAY_MS = 300;

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
      await sync(app.db, app.env, store);
    } catch (err) {
      app.log.error({ err, storeId: store.id }, 'shopify billing sync failed for store');
    }
    await sleepImpl(PARTNER_API_MIN_DELAY_MS);
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
  const timer = setInterval(() => {
    void runBillingSyncTick(app).catch((err) => {
      app.log.error({ err }, 'billing sync tick failed');
    });
  }, intervalMs);
  return () => clearInterval(timer);
}
