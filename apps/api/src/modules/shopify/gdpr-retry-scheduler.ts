import { schema } from '@aivastra/db';
import { eq, isNotNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { redactShopperData } from './gdpr.js';

/**
 * Retry outstanding GDPR erasures.
 *
 * `redactShopperData` is already retry-safe by construction — an R2 key is
 * only nulled once its own delete succeeded, and a shopper row is only deleted
 * once every object of theirs is gone — so finishing a half-done erasure is
 * simply a matter of running it again. What was missing was any record of
 * which erasures were outstanding: a leftover shopper row is indistinguishable
 * from an ordinary one, so nothing could find them. Retention has an hourly
 * sweeper; redaction had none, and an object delete that failed once stayed
 * failed until a human read the logs — against a 30-day statutory deadline.
 *
 * The outstanding work is found from `redaction_requested_at` stamps rather
 * than from a queue holding the webhook payloads, so retrying an erasure never
 * requires keeping a copy of the email or customer id being erased.
 */

/** One tick handles at most this many of each kind, so a backlog can't monopolise it. */
const BATCH = 25;

export interface RedactionRetryResult {
  shoppersAttempted: number;
  shoppersCompleted: number;
  storesAttempted: number;
  storesCompleted: number;
}

export async function runRedactionRetryTick(app: FastifyInstance): Promise<RedactionRetryResult> {
  const result: RedactionRetryResult = {
    shoppersAttempted: 0,
    shoppersCompleted: 0,
    storesAttempted: 0,
    storesCompleted: 0,
  };

  // ── Per-subject retries (customers_redact) ────────────────────────────────
  const pendingShoppers = await app.db
    .select({ id: schema.shopifyShoppers.id, storeId: schema.shopifyShoppers.storeId })
    .from(schema.shopifyShoppers)
    .where(isNotNull(schema.shopifyShoppers.redactionRequestedAt))
    .limit(BATCH);

  // Grouped per store because redactShopperData is stored-scoped: one call per
  // store finishes every outstanding subject there in a single walk.
  const byStore = new Map<string, string[]>();
  for (const row of pendingShoppers) {
    const list = byStore.get(row.storeId);
    if (list) list.push(row.id);
    else byStore.set(row.storeId, [row.id]);
  }

  for (const [storeId, shopperIds] of byStore) {
    result.shoppersAttempted += shopperIds.length;
    try {
      const outcome = await redactShopperData(app, storeId, { shopperIds });
      result.shoppersCompleted += outcome.removed;
      if (outcome.incomplete > 0) {
        app.log.error(
          { storeId, removed: outcome.removed, incomplete: outcome.incomplete },
          'gdpr retry: erasure still incomplete — objects remain undeleted, will retry next tick',
        );
      } else {
        app.log.info(
          { storeId, removed: outcome.removed },
          'gdpr retry: outstanding shopper erasure completed',
        );
      }
    } catch (err) {
      // One store's failure must not abandon the rest of the batch.
      app.log.error({ err, storeId }, 'gdpr retry: shopper erasure attempt failed');
    }
  }

  // ── Whole-shop retries (shop_redact) ──────────────────────────────────────
  const pendingStores = await app.db
    .select({ id: schema.shopifyStores.id, shopDomain: schema.shopifyStores.shopDomain })
    .from(schema.shopifyStores)
    .where(isNotNull(schema.shopifyStores.redactionRequestedAt))
    .limit(BATCH);

  for (const store of pendingStores) {
    result.storesAttempted += 1;
    try {
      const outcome = await redactShopperData(app, store.id, { matchAll: true });
      if (outcome.incomplete > 0) {
        app.log.error(
          {
            storeId: store.id,
            shopDomain: store.shopDomain,
            removed: outcome.removed,
            incomplete: outcome.incomplete,
          },
          'gdpr retry: store purge still incomplete — objects remain undeleted, will retry next tick',
        );
        continue;
      }
      // Cleared only on a pass that reported nothing left behind — including
      // the unlinked-job sweep, which no shopper row would have recorded.
      await app.db
        .update(schema.shopifyStores)
        .set({ redactionRequestedAt: null })
        .where(eq(schema.shopifyStores.id, store.id));
      result.storesCompleted += 1;
      app.log.info(
        { storeId: store.id, shopDomain: store.shopDomain, removed: outcome.removed },
        'gdpr retry: outstanding store purge completed',
      );
    } catch (err) {
      app.log.error({ err, storeId: store.id }, 'gdpr retry: store purge attempt failed');
    }
  }

  return result;
}

const THIRTY_MINUTES_MS = 30 * 60 * 1000;

/**
 * Half-hourly. The statutory window is 30 days, so this does not need to be
 * aggressive — it needs to be reliable, and to stop depending on somebody
 * noticing a log line. A tick where nothing is outstanding is two indexed
 * queries against partial indexes that are empty in the normal case.
 *
 * Call once after `app.listen(...)`.
 */
export function startRedactionRetryScheduler(
  app: FastifyInstance,
  intervalMs: number = THIRTY_MINUTES_MS,
): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) {
      app.log.warn('gdpr redaction retry tick still running — skipping this interval');
      return;
    }
    running = true;
    void runRedactionRetryTick(app)
      .catch((err) => {
        app.log.error({ err }, 'gdpr redaction retry tick failed');
      })
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  return () => clearInterval(timer);
}
