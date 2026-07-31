import { schema } from '@aivastra/db';
import { ShopifyStoreSettingsPatch } from '@aivastra/types';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

export async function shopifySettingsRoutes(app: FastifyInstance) {
  app.patch(
    '/v1/shopify/settings',
    { preValidation: app.requireShopifySession, schema: { body: ShopifyStoreSettingsPatch } },
    async (req) => {
      const store = req.shopifyStore as typeof schema.shopifyStores.$inferSelect;
      const body = req.body as ShopifyStoreSettingsPatch;

      // Shallow-merge each sub-object so a PATCH touching only `limits` cannot
      // drop `retention`, `themeBlockConfirmed`, or `workflowTemplateId`.
      const settings = {
        ...store.settings,
        ...(body.limits ? { limits: { ...store.settings.limits, ...body.limits } } : {}),
        ...(body.retention
          ? { retention: { ...store.settings.retention, ...body.retention } }
          : {}),
      };

      await app.db
        .update(schema.shopifyStores)
        .set({ settings, updatedAt: new Date() })
        .where(eq(schema.shopifyStores.id, store.id));

      req.log.info(
        { storeId: store.id, changed: Object.keys(body) },
        'shopify store settings updated',
      );
      return { settings };
    },
  );
}
