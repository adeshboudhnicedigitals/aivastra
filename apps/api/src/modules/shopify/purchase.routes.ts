import type { schema } from '@aivastra/db';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { confirmPurchase, createPurchase } from './purchase.js';

const PurchaseBody = z.object({ packId: z.string().min(1).max(64) });
const ConfirmQuery = z.object({ purchase: z.string().uuid() });

export async function shopifyPurchaseRoutes(app: FastifyInstance) {
  app.post(
    '/v1/shopify/billing/purchase',
    { preHandler: app.requireShopifySession, schema: { body: PurchaseBody } },
    async (req) => {
      const store = req.shopifyStore as typeof schema.shopifyStores.$inferSelect;
      const { packId } = req.body as z.infer<typeof PurchaseBody>;
      return createPurchase(app, store, packId);
    },
  );

  app.get(
    '/v1/shopify/billing/purchase/confirm',
    { preHandler: app.requireShopifySession, schema: { querystring: ConfirmQuery } },
    async (req) => {
      const store = req.shopifyStore as typeof schema.shopifyStores.$inferSelect;
      const { purchase } = req.query as z.infer<typeof ConfirmQuery>;
      return confirmPurchase(app, store, purchase);
    },
  );
}
