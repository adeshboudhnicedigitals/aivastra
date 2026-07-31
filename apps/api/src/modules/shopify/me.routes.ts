import { schema } from '@aivastra/db';
import { and, count, eq, gte, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { windowStart } from './store-day.js';

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

    const [{ enabledProductCount }] = await app.db
      .select({ enabledProductCount: count() })
      .from(schema.shopifyProductGarments)
      .where(
        and(
          eq(schema.shopifyProductGarments.storeId, store.id),
          eq(schema.shopifyProductGarments.enabled, true),
          sql`${schema.shopifyProductGarments.status} <> 'deleted'`,
        ),
      );

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
