import { schema } from '@aivastra/db';
import { and, count, eq, gte, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { windowStart } from './store-day.js';

/**
 * Activation-aware count of products effectively enabled for try-on, for the
 * Dashboard's "Try-On Enabled" stat and the onboarding gate. Must agree with
 * the precedence rule in `activation.ts` (`computeEffectiveEnabled`):
 * exclusion — individual or via an excluded collection — always wins, even
 * under global mode.
 *
 * Global mode: every synced, non-deleted product counts except ones excluded
 * (individually or via an excluded collection).
 *
 * Selective mode: the union of individually-enabled products and products
 * reachable through an enabled collection, minus the same exclusions. Counted
 * as one query over `shopify_product_garments` with EXISTS subqueries so each
 * product is counted at most once (no double counting between the two
 * enablement paths).
 */
async function computeEnabledProductCount(
  app: FastifyInstance,
  store: typeof schema.shopifyStores.$inferSelect,
): Promise<number> {
  const mode = store.settings.activation?.mode ?? 'selective';

  const notExcludedByCollection = sql`NOT EXISTS (
    SELECT 1 FROM shopify_collection_products cp
    JOIN shopify_excluded_collections xc
      ON xc.store_id = cp.store_id AND xc.shopify_collection_id = cp.shopify_collection_id
    WHERE cp.store_id = pg.store_id AND cp.shopify_product_id = pg.shopify_product_id
  )`;

  const enabledViaCollection = sql`EXISTS (
    SELECT 1 FROM shopify_collection_products cp
    JOIN shopify_enabled_collections ec
      ON ec.store_id = cp.store_id AND ec.shopify_collection_id = cp.shopify_collection_id
    WHERE cp.store_id = pg.store_id AND cp.shopify_product_id = pg.shopify_product_id
  )`;

  const enablementCondition =
    mode === 'global' ? sql`true` : sql`(pg.enabled = true OR ${enabledViaCollection})`;

  const result = await app.db.execute<{ cnt: number }>(sql`
    SELECT COUNT(*)::int AS cnt
    FROM shopify_product_garments pg
    WHERE pg.store_id = ${store.id}
      AND pg.status <> 'deleted'
      AND pg.excluded = false
      AND ${notExcludedByCollection}
      AND ${enablementCondition}
  `);
  return (result as unknown as Array<{ cnt: number }>)[0]?.cnt ?? 0;
}

export async function shopifyMeRoutes(app: FastifyInstance) {
  app.get('/v1/shopify/me', { preHandler: app.requireShopifySession }, async (req) => {
    const store = req.shopifyStore as typeof schema.shopifyStores.$inferSelect;

    let creditBalance: number | null = null;
    if (store.ownerUserId) {
      const [row] = await app.db
        .select({ balance: schema.userCredits.balance })
        .from(schema.userCredits)
        .where(eq(schema.userCredits.userId, store.ownerUserId))
        .limit(1);
      creditBalance = row?.balance ?? 0;
    }

    const [{ totalTryOns }] = await app.db
      .select({ totalTryOns: count() })
      .from(schema.jobs)
      .where(eq(schema.jobs.shopifyStoreId, store.id));

    const [{ syncedProductCount }] = await app.db
      .select({ syncedProductCount: count() })
      .from(schema.shopifyProductGarments)
      .where(eq(schema.shopifyProductGarments.storeId, store.id));

    const enabledProductCount = await computeEnabledProductCount(app, store);

    const [{ activeCount, processingCount, failedCount, disabledCount }] = await app.db
      .select({
        activeCount: sql<number>`COUNT(*) FILTER (WHERE ${schema.shopifyProductGarments.enabled} = true AND ${schema.shopifyProductGarments.status} = 'active')::int`,
        processingCount: sql<number>`COUNT(*) FILTER (WHERE ${schema.shopifyProductGarments.enabled} = true AND ${schema.shopifyProductGarments.status} = 'processing')::int`,
        failedCount: sql<number>`COUNT(*) FILTER (WHERE ${schema.shopifyProductGarments.enabled} = true AND ${schema.shopifyProductGarments.status} = 'failed')::int`,
        disabledCount: sql<number>`COUNT(*) FILTER (WHERE ${schema.shopifyProductGarments.enabled} = false OR ${schema.shopifyProductGarments.status} = 'deleted')::int`,
      })
      .from(schema.shopifyProductGarments)
      .where(eq(schema.shopifyProductGarments.storeId, store.id));

    // Derived from Postgres, not the Redis cap counter: the merchant-facing
    // number must stay correct even if Redis has been flushed and the guard
    // has lost the day.
    const [{ todayTryOns }] = await app.db
      .select({ todayTryOns: count() })
      .from(schema.jobs)
      .where(
        and(
          eq(schema.jobs.shopifyStoreId, store.id),
          gte(schema.jobs.createdAt, windowStart(store.ianaTimezone, 'day')),
        ),
      );

    const [{ capturedEmailCount }] = await app.db
      .select({ capturedEmailCount: count() })
      .from(schema.shopifyShoppers)
      .where(
        and(
          eq(schema.shopifyShoppers.storeId, store.id),
          sql`${schema.shopifyShoppers.email} IS NOT NULL`,
        ),
      );

    return {
      store: {
        shopDomain: store.shopDomain,
        settings: store.settings,
        ownerUserId: store.ownerUserId,
        connectedSince: store.installedAt.toISOString(),
      },
      creditBalance,
      stats: {
        totalTryOns,
        syncedProductCount,
        enabledProductCount,
        statusCounts: {
          active: activeCount,
          processing: processingCount,
          failed: failedCount,
          disabled: disabledCount,
        },
        todayTryOns,
        storeDailyCap: store.settings.limits?.storeDailyCap ?? null,
        capturedEmailCount,
      },
    };
  });
}
