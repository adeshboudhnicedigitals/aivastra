import type { schema } from '@aivastra/db';
import type { FastifyInstance } from 'fastify';
import { shopifyActivationRoutes } from './activation.routes.js';
import { shopifyAnalyticsRoutes } from './analytics.routes.js';
import { shopifyAuthRoutes } from './auth.routes.js';
import { shopifyAutorefillRoutes } from './autorefill.routes.js';
import { shopifyEventsRoutes } from './events.routes.js';
import { shopifyMeRoutes } from './me.routes.js';
import { shopifyOnboardingRoutes } from './onboarding.routes.js';
import { shopifyProductsRoutes } from './products.routes.js';
import { shopifyPurchaseRoutes } from './purchase.routes.js';
import { enqueueSync, getProductSyncStatus, markProductSyncRunning } from './service.js';
import { shopifySettingsRoutes } from './settings.routes.js';
import { shopifyShoppersRoutes } from './shoppers.routes.js';
import { shopifySupportRoutes } from './support.routes.js';
import { registerWebhooksDecorator, shopifyWebhookRoutes } from './webhook.routes.js';
import { shopifyWidgetConfigRoutes } from './widget-config.routes.js';

export async function shopifyRoutes(app: FastifyInstance) {
  // Must register before shopifyAuthRoutes: the callback handler in auth.routes.ts
  // calls `app.shopifyRegisterWebhooks?.()`. registerWebhooksDecorator is wrapped in
  // fp(), so it decorates this shared context (no new child context), meaning the
  // decoration exists before shopifyAuthRoutes' own child context is created below
  // and is inherited by it.
  await app.register(registerWebhooksDecorator);
  await app.register(shopifyAuthRoutes);
  await app.register(shopifyMeRoutes);
  await app.register(shopifyPurchaseRoutes);
  await app.register(shopifyAutorefillRoutes);
  await app.register(shopifyProductsRoutes);
  await app.register(shopifyOnboardingRoutes);
  await app.register(shopifySettingsRoutes);
  await app.register(shopifyEventsRoutes);
  await app.register(shopifyAnalyticsRoutes);
  await app.register(shopifyWidgetConfigRoutes);
  await app.register(shopifyShoppersRoutes);
  await app.register(shopifySupportRoutes);
  await app.register(shopifyActivationRoutes);
  // Plain (non-fp) function: gets its own encapsulated child context, so the
  // raw-body JSON content-type parser registered inside stays scoped to these
  // webhook routes only and never leaks to sibling routes or the rest of the app.
  await app.register(shopifyWebhookRoutes);

  app.post(
    '/v1/shopify/products/sync',
    { preHandler: app.requireShopifySession },
    async (req, reply) => {
      const store = req.shopifyStore as typeof schema.shopifyStores.$inferSelect;
      // Set before XADD, not after: the sync consumer can, on a fast/empty
      // store, finish and clear this same key before the route ever gets
      // back around to writing it, which would leave the button's poll
      // watching a 'running' state nothing will ever clear.
      await markProductSyncRunning(app.redis, store.id);
      await enqueueSync(app.redis, { storeId: store.id, mode: 'full' });
      return reply.code(202).send({ queued: true });
    },
  );

  // Polled by ManagePage.tsx's "Sync products" button — the POST above only
  // enqueues; the actual sync runs in the background consumer and can outlive
  // the request by well over a page refetch's worth of time (see
  // markProductSyncRunning/markProductSyncIdle in service.ts).
  app.get(
    '/v1/shopify/products/sync/status',
    { preHandler: app.requireShopifySession },
    async (req) => {
      const store = req.shopifyStore as typeof schema.shopifyStores.$inferSelect;
      return getProductSyncStatus(app.redis, store.id);
    },
  );
}
