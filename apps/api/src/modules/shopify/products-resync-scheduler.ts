import { schema } from '@aivastra/db';
import { ne } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { enqueueSync } from './service.js';

/**
 * One tick: enqueue a `reconcile`-mode sync task for every store with at
 * least one non-deleted product row. This is the backstop for the
 * products/delete webhook — that webhook's subscription is only registered
 * once, at install/reauth, with registration failures merely logged, and a
 * dropped delivery afterward has no other way to be noticed. A store that has
 * never synced (or whose rows are already all deleted) triggers zero Shopify
 * calls.
 */
export async function runResyncTick(app: FastifyInstance): Promise<void> {
  const stores = await app.db
    .selectDistinct({ storeId: schema.shopifyProductGarments.storeId })
    .from(schema.shopifyProductGarments)
    .where(ne(schema.shopifyProductGarments.status, 'deleted'));

  for (const { storeId } of stores) {
    await enqueueSync(app.redis, { storeId, mode: 'reconcile' });
  }
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * Call once after `app.listen(...)`, alongside `startSyncConsumer(app)` and
 * `startCollectionResyncScheduler(app)` — mirrors their "start once, get a
 * stop function back" shape.
 */
export function startProductResyncScheduler(
  app: FastifyInstance,
  intervalMs: number = HOUR_MS,
): () => void {
  const timer = setInterval(() => {
    void runResyncTick(app).catch((err) => {
      app.log.error({ err }, 'product resync tick failed');
    });
  }, intervalMs);
  return () => clearInterval(timer);
}
