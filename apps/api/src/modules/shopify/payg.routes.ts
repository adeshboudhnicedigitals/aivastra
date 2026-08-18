import { schema } from '@aivastra/db';
import { PaygSpendCapBody } from '@aivastra/types';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

export async function shopifyPaygRoutes(app: FastifyInstance) {
  app.patch(
    '/v1/shopify/billing/payg-cap',
    { preHandler: app.requireShopifySession, schema: { body: PaygSpendCapBody } },
    async (req) => {
      const store = req.shopifyStore as typeof schema.shopifyStores.$inferSelect;
      const { spendCapUsdCents } = req.body as PaygSpendCapBody;

      await app.db
        .update(schema.shopifyStores)
        .set({ paygSpendCapUsdCents: spendCapUsdCents, updatedAt: new Date() })
        .where(eq(schema.shopifyStores.id, store.id));

      return { paygSpendCapUsdCents: spendCapUsdCents };
    },
  );
}
