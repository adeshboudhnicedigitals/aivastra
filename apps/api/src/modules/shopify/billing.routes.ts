import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { syncStoreSubscription } from './billing.js';

export async function shopifyBillingRoutes(app: FastifyInstance) {
  // The merchant lands here after Shopify's plan-selection/charge-confirmation
  // redirect (see buildPlanSelectionUrl in billing.ts and the welcome-link
  // config in Partner Dashboard). Shopify appends plan_handle/shop as query
  // params, but those are merchant-controllable via the URL bar — this route
  // never trusts them. It re-fetches the real state from the Partner API via
  // syncStoreSubscription instead, exactly like the periodic scheduler does.
  app.get('/v1/shopify/billing/confirm', { preHandler: app.requireShopifySession }, async (req) => {
    const store = req.shopifyStore as typeof schema.shopifyStores.$inferSelect;
    const result = await syncStoreSubscription(app.db, app.env, store);

    let creditBalance: number | null = null;
    if (store.ownerUserId) {
      const [row] = await app.db
        .select({ balance: schema.userCredits.balance })
        .from(schema.userCredits)
        .where(eq(schema.userCredits.userId, store.ownerUserId))
        .limit(1);
      creditBalance = row?.balance ?? 0;
    }

    return {
      planHandle: result.planHandle,
      subscriptionStatus: result.subscriptionStatus,
      creditBalance,
    };
  });
}
