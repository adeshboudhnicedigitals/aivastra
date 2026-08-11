import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { syncStoreSubscription } from './billing.js';

export async function shopifyBillingRoutes(app: FastifyInstance) {
  // The merchant lands here after Shopify's plan-selection/charge-confirmation
  // redirect (see buildPlanSelectionUrl in billing.ts and the welcome-link
  // config in Partner Dashboard). Shopify appends plan_handle/shop as query
  // params, but those are merchant-controllable via the URL bar — this route
  // never trusts them. It re-fetches the real state from Shopify's Admin API
  // via syncStoreSubscription instead, exactly like the periodic scheduler does.
  app.get('/v1/shopify/billing/confirm', { preHandler: app.requireShopifySession }, async (req) => {
    const store = req.shopifyStore as typeof schema.shopifyStores.$inferSelect;
    const result = await syncStoreSubscription(app, store);

    const [creditRow] = await app.db
      .select({ balance: schema.shopifyStoreCredits.balance })
      .from(schema.shopifyStoreCredits)
      .where(eq(schema.shopifyStoreCredits.storeId, store.id))
      .limit(1);
    const creditBalance = creditRow?.balance ?? 0;

    return {
      planHandle: result.planHandle,
      subscriptionStatus: result.subscriptionStatus,
      creditBalance,
    };
  });
}
