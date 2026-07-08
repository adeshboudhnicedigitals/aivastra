import { schema } from '@aivastra/db';
import { count, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const ProductsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export async function shopifyProductsRoutes(app: FastifyInstance) {
  app.get(
    '/v1/shopify/products',
    { preHandler: app.requireShopifySession, schema: { querystring: ProductsQuery } },
    async (req) => {
      const store = req.shopifyStore as typeof schema.shopifyStores.$inferSelect;
      const { page, pageSize } = req.query as z.infer<typeof ProductsQuery>;

      const [{ total }] = await app.db
        .select({ total: count() })
        .from(schema.shopifyProductGarments)
        .where(eq(schema.shopifyProductGarments.storeId, store.id));

      const rows = await app.db
        .select({
          shopifyProductId: schema.shopifyProductGarments.shopifyProductId,
          title: schema.shopifyProductGarments.title,
          r2Key: schema.shopifyProductGarments.r2Key,
          status: schema.shopifyProductGarments.status,
          enabled: schema.shopifyProductGarments.enabled,
        })
        .from(schema.shopifyProductGarments)
        .where(eq(schema.shopifyProductGarments.storeId, store.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      const items = rows.map((r) => ({
        shopifyProductId: r.shopifyProductId,
        title: r.title,
        thumbnailUrl: app.storage.publicUrl(r.r2Key),
        status: r.status,
        enabled: r.enabled,
      }));

      return { page, pageSize, total, items };
    },
  );
}
