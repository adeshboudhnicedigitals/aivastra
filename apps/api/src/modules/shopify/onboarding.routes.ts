import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

export async function shopifyOnboardingRoutes(app: FastifyInstance) {
  app.post(
    '/v1/shopify/onboarding/confirm-theme-block',
    { preHandler: app.requireShopifySession },
    async (req) => {
      const store = req.shopifyStore as typeof schema.shopifyStores.$inferSelect;
      const settings = { ...store.settings, themeBlockConfirmed: true };

      await app.db
        .update(schema.shopifyStores)
        .set({ settings, updatedAt: new Date() })
        .where(eq(schema.shopifyStores.id, store.id));

      return { settings };
    },
  );
}
