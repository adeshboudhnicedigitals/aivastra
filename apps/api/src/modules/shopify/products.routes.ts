import { schema } from '@aivastra/db';
import { count, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { decryptToken } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';
import { assertShopifyCdn } from './products.sync.js';
import { SHOPIFY_API_VERSION } from './service.js';

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

  app.get(
    '/v1/shopify/products/:id/images',
    { preHandler: app.requireShopifySession },
    async (req) => {
      const store = req.shopifyStore as typeof schema.shopifyStores.$inferSelect;
      const { id } = req.params as { id: string };
      const token = decryptToken(store.accessToken, app.env.SHOPIFY_TOKEN_ENC_KEY ?? '');

      const res = await fetch(
        `https://${store.shopDomain}/admin/api/${SHOPIFY_API_VERSION}/products/${id}/images.json`,
        { headers: { 'X-Shopify-Access-Token': token } },
      );
      if (!res.ok) {
        throw new AppError('SHOPIFY', 502, 'failed to fetch product images');
      }
      const { images } = (await res.json()) as { images: { id: number; src: string }[] };
      for (const img of images) assertShopifyCdn(img.src);

      return { images: images.map((img) => ({ id: img.id, src: img.src })) };
    },
  );
}
