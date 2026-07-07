import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
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

    return {
      store: { shopDomain: store.shopDomain, settings: store.settings },
      credits: credits?.balance ?? 0,
      plan,
    };
  });
}
