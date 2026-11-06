import type { schema } from '@aivastra/db';
import type { FastifyInstance } from 'fastify';
import { fetchTotalProductCount } from './activation.routes.js';
import {
  enqueueSync,
  getProductSyncStatus,
  isProductSyncActive,
  markProductSyncRunning,
} from './service.js';

/** Queues a full product sync for the store unless one is already queued or
 *  running. Shared by the merchant's "Sync products" button and the admin panel's. */
export async function requestFullSync(
  app: FastifyInstance,
  store: typeof schema.shopifyStores.$inferSelect,
): Promise<{ queued: boolean; alreadyRunning?: true }> {
  // A sync already queued or running covers this request — the caller polls
  // the same status key either way. Not atomic with the mark below; the
  // worst a race costs is the duplicate this check exists to avoid.
  if (isProductSyncActive(await getProductSyncStatus(app.redis, store.id))) {
    return { queued: false, alreadyRunning: true };
  }
  // Set before XADD, not after: the sync consumer can, on a fast/empty
  // store, finish and clear this same key before the caller ever gets
  // back around to writing it, which would leave the button's poll
  // watching a 'running' state nothing will ever clear.
  // Best effort: the progress bar degrades to indeterminate without a total.
  const total = await fetchTotalProductCount(app, store);
  await markProductSyncRunning(app.redis, store.id, total);
  await enqueueSync(app.redis, { storeId: store.id, mode: 'full' });
  return { queued: true };
}
