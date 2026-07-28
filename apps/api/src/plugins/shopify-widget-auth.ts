import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import fp from 'fastify-plugin';
import { AppError } from '../lib/errors.js';
import { isShopifyPreviewOrigin } from '../lib/shopify-origin.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const shopifyWidgetAuthPlugin = fp(async (app) => {
  app.decorate('requireShopifyStoreKey', async (req, _reply) => {
    const key = req.headers['x-widget-key'];
    if (!key || typeof key !== 'string') {
      throw new AppError('UNAUTHORIZED', 401, 'Missing X-Widget-Key header');
    }
    // storeKey is a uuid column — a malformed value would otherwise reach Postgres
    // as an invalid input syntax error (unhandled, 500) instead of the intended 401.
    if (!UUID_RE.test(key)) {
      throw new AppError('UNAUTHORIZED', 401, 'Invalid or inactive store key');
    }
    const [store] = await app.db
      .select()
      .from(schema.shopifyStores)
      .where(eq(schema.shopifyStores.storeKey, key))
      .limit(1);
    if (!store || store.uninstalledAt) {
      throw new AppError('UNAUTHORIZED', 401, 'Invalid or inactive store key');
    }
    if (store.allowedOrigins.length > 0) {
      const origin = req.headers.origin ?? '';
      if (!store.allowedOrigins.includes(origin) && !isShopifyPreviewOrigin(origin)) {
        throw new AppError('FORBIDDEN', 403, 'Origin not allowed');
      }
    }
    req.shopifyStoreId = store.id;
    req.shopifyStoreRow = store;
  });
});

import type { InferSelectModel } from 'drizzle-orm';

declare module 'fastify' {
  interface FastifyRequest {
    shopifyStoreId?: string;
    shopifyStoreRow?: InferSelectModel<typeof schema.shopifyStores>;
  }
  interface FastifyInstance {
    requireShopifyStoreKey: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
