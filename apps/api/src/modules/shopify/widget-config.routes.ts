import type { ShopifyWidgetConfig } from '@aivastra/db';
import { schema } from '@aivastra/db';
import { ShopifyWidgetConfigPatch } from '@aivastra/types';
import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { writeWidgetConfigMetafield } from './metafields.js';
import { getValidAccessToken } from './token.js';

type Store = typeof schema.shopifyStores.$inferSelect;

/**
 * Mirror the stored config into the shop metafield Liquid reads.
 *
 * Token acquisition is deliberately OUTSIDE the writer's own try/catch: a dead
 * or scope-stale token throws SHOPIFY_REAUTH_REQUIRED, which the SPA turns into
 * a one-click reauth. Swallowing it into `synced: false` would show the merchant
 * a "retry" button that can never succeed.
 */
async function publishConfig(
  app: FastifyInstance,
  store: Store,
  log: FastifyBaseLogger,
): Promise<boolean> {
  const accessToken = await getValidAccessToken(app, store);
  return writeWidgetConfigMetafield(
    store.shopDomain,
    accessToken,
    store.shopifyShopId,
    store.settings.widget ?? {},
    log,
  );
}

export async function shopifyWidgetConfigRoutes(app: FastifyInstance) {
  app.patch(
    '/v1/shopify/widget-config',
    { preValidation: app.requireShopifySession, schema: { body: ShopifyWidgetConfigPatch } },
    async (req) => {
      const store = req.shopifyStore as Store;
      const body = req.body as ShopifyWidgetConfigPatch;
      const current = store.settings.widget ?? {};

      // Shallow-merge each sub-object so a PATCH touching only `copy` cannot
      // drop `theme` or `behavior`, and so patching one copy field cannot drop
      // the other eight.
      const widget: ShopifyWidgetConfig = {
        ...current,
        ...(body.theme ? { theme: { ...current.theme, ...body.theme } } : {}),
        ...(body.copy ? { copy: { ...current.copy, ...body.copy } } : {}),
        ...(body.behavior ? { behavior: { ...current.behavior, ...body.behavior } } : {}),
      };
      const settings = { ...store.settings, widget };

      await app.db
        .update(schema.shopifyStores)
        .set({ settings, updatedAt: new Date() })
        .where(eq(schema.shopifyStores.id, store.id));

      // Postgres is authoritative and already committed. The metafield is a
      // cache, so a failed mirror is reported as synced:false on a 200 — a 5xx
      // here would tell the merchant their copy was lost when it was not.
      const synced = await publishConfig(app, { ...store, settings }, req.log);

      req.log.info(
        { storeId: store.id, changed: Object.keys(body), synced },
        'shopify widget config updated',
      );
      return { widget, synced };
    },
  );

  app.post(
    '/v1/shopify/widget-config/republish',
    { preValidation: app.requireShopifySession },
    async (req) => {
      const store = req.shopifyStore as Store;
      const synced = await publishConfig(app, store, req.log);
      req.log.info({ storeId: store.id, synced }, 'shopify widget config republished');
      return { synced };
    },
  );
}
