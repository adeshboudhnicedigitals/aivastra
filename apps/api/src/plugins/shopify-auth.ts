import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import fp from 'fastify-plugin';
import { AppError } from '../lib/errors.js';
import { verifySessionToken } from '../modules/shopify/service.js';

export const shopifyAuthPlugin = fp(async (app) => {
  app.decorate('requireShopifySession', async (req, _reply) => {
    const secret = app.env.SHOPIFY_API_SECRET;
    const apiKey = app.env.SHOPIFY_API_KEY;
    if (!secret || !apiKey) throw new AppError('CONFIG', 500, 'Shopify not configured');

    const auth = req.headers.authorization;
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : undefined;
    if (!token) throw new AppError('UNAUTHORIZED', 401, 'Missing session token');

    let shopDomain: string;
    try {
      ({ shopDomain } = verifySessionToken(token, secret, apiKey));
    } catch {
      throw new AppError('UNAUTHORIZED', 401, 'Invalid session token');
    }

    const [store] = await app.db
      .select()
      .from(schema.shopifyStores)
      .where(eq(schema.shopifyStores.shopDomain, shopDomain))
      .limit(1);
    if (!store || store.uninstalledAt) throw new AppError('FORBIDDEN', 403, 'Store not installed');

    req.shopifyStore = store;
  });
});

import type { InferSelectModel } from 'drizzle-orm';

declare module 'fastify' {
  interface FastifyRequest {
    shopifyStore?: InferSelectModel<typeof schema.shopifyStores>;
  }
  interface FastifyInstance {
    requireShopifySession: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
