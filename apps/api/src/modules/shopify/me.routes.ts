import { schema } from '@aivastra/db';
import { and, count, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

export async function shopifyMeRoutes(app: FastifyInstance) {
  app.get('/v1/shopify/me', { preHandler: app.requireShopifySession }, async (req) => {
    const store = req.shopifyStore as typeof schema.shopifyStores.$inferSelect;

    const [credits] = await app.db
      .select({ balance: schema.widgetClientCredits.balance })
      .from(schema.widgetClientCredits)
      .where(eq(schema.widgetClientCredits.widgetClientId, store.widgetClientId))
      .limit(1);

    let plan: typeof schema.shopifyPlans.$inferSelect | null = null;
    if (store.shopifyPlanId) {
      const [row] = await app.db
        .select()
        .from(schema.shopifyPlans)
        .where(eq(schema.shopifyPlans.id, store.shopifyPlanId))
        .limit(1);
      plan = row ?? null;
    }

    const [{ totalTryOns }] = await app.db
      .select({ totalTryOns: count() })
      .from(schema.jobs)
      .where(eq(schema.jobs.widgetClientId, store.widgetClientId));

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
        ),
      );

    return {
      store: { shopDomain: store.shopDomain, settings: store.settings },
      credits: credits?.balance ?? 0,
      plan,
      stats: { totalTryOns, syncedProductCount, enabledProductCount },
    };
  });
}
