import { type DB, schema } from '@aivastra/db';
import type { Logger } from '@aivastra/logger';
import type { StorageProvider } from '@aivastra/storage';
import { and, eq, isNotNull, lt, or } from 'drizzle-orm';

// Bounded so one store with a long backlog cannot monopolise a pass. The
// sweeper runs hourly; anything left over is picked up next time.
const BATCH = 500;

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);

/** Delete an R2 object, tolerating failure. One unreachable object must not
 *  wedge retention for an entire store — the next pass retries it. */
async function tryDelete(storage: StorageProvider, key: string, log: Logger): Promise<boolean> {
  try {
    await storage.deleteObject(key);
    return true;
  } catch (err) {
    log.warn({ err, key }, 'shopify retention: object delete failed, will retry next pass');
    return false;
  }
}

/**
 * Delete shopper PII past each store's configured retention.
 *
 * Never deletes a `jobs` row: it is a billing record tied to a credit
 * deduction and a ledger entry. Retention deletes the R2 objects and nulls the
 * key columns; the job, its cost, and its timestamp survive.
 *
 * Idempotent — a null key is skipped, so a crash mid-batch simply re-runs.
 */
export async function runShopifyRetention(
  db: DB,
  storage: StorageProvider,
  log: Logger,
): Promise<void> {
  const stores = await db.select().from(schema.shopifyStores);

  for (const store of stores) {
    const retention = store.settings?.retention;
    if (!retention) continue;

    if (retention.shopperPhotoDays != null) {
      const rows = await db
        .select({ id: schema.jobs.id, key: schema.jobs.customerPhotoKey })
        .from(schema.jobs)
        .where(
          and(
            eq(schema.jobs.shopifyStoreId, store.id),
            isNotNull(schema.jobs.customerPhotoKey),
            lt(schema.jobs.createdAt, daysAgo(retention.shopperPhotoDays)),
          ),
        )
        .limit(BATCH);

      for (const row of rows) {
        if (!row.key) continue;
        if (!(await tryDelete(storage, row.key, log))) continue;
        await db
          .update(schema.jobs)
          .set({ customerPhotoKey: null })
          .where(eq(schema.jobs.id, row.id));
      }
      if (rows.length > 0) {
        log.info({ storeId: store.id, count: rows.length }, 'shopify retention: photos purged');
      }
    }

    if (retention.resultDays != null) {
      const rows = await db
        .select({
          jobId: schema.jobOutputs.jobId,
          resultKey: schema.jobOutputs.resultKey,
          thumbnailKey: schema.jobOutputs.thumbnailKey,
        })
        .from(schema.jobOutputs)
        .innerJoin(schema.jobs, eq(schema.jobs.id, schema.jobOutputs.jobId))
        .where(
          and(
            eq(schema.jobs.shopifyStoreId, store.id),
            // Either key alone still makes this row a retry candidate: a row
            // whose resultKey delete succeeded but whose thumbnailKey delete
            // failed must stay in scope on the next pass, or the orphaned
            // thumbnail object and its stale reference are never retried.
            or(isNotNull(schema.jobOutputs.resultKey), isNotNull(schema.jobOutputs.thumbnailKey)),
            lt(schema.jobs.createdAt, daysAgo(retention.resultDays)),
          ),
        )
        .limit(BATCH);

      for (const row of rows) {
        // The two keys are nulled independently: one object may delete
        // successfully while its sibling transiently fails, and a failed
        // delete must leave its own column non-null so the next pass retries
        // just that object rather than orphaning it.
        const update: { resultKey?: null; thumbnailKey?: null } = {};
        if (row.resultKey) {
          if (await tryDelete(storage, row.resultKey, log)) update.resultKey = null;
        }
        if (row.thumbnailKey) {
          if (await tryDelete(storage, row.thumbnailKey, log)) update.thumbnailKey = null;
        }
        if (Object.keys(update).length > 0) {
          await db
            .update(schema.jobOutputs)
            .set(update)
            .where(eq(schema.jobOutputs.jobId, row.jobId));
        }
      }
      if (rows.length > 0) {
        log.info({ storeId: store.id, count: rows.length }, 'shopify retention: results purged');
      }
    }

    if (retention.shopperRecordDays != null) {
      // jobs.shopify_shopper_id is ON DELETE SET NULL, so this severs the link
      // without touching billing history.
      const deleted = await db
        .delete(schema.shopifyShoppers)
        .where(
          and(
            eq(schema.shopifyShoppers.storeId, store.id),
            lt(schema.shopifyShoppers.lastSeenAt, daysAgo(retention.shopperRecordDays)),
          ),
        )
        .returning({ id: schema.shopifyShoppers.id });
      if (deleted.length > 0) {
        log.info(
          { storeId: store.id, count: deleted.length },
          'shopify retention: shopper records purged',
        );
      }
    }
  }
}
