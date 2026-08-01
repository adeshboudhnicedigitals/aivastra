import type { ShopifyWidgetConfig } from '@aivastra/db';
import { schema } from '@aivastra/db';
import { ShopifyWidgetConfigPatch } from '@aivastra/types';
import { eq, sql } from 'drizzle-orm';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { AppError } from '../../lib/errors.js';
import { writeWidgetConfigMetafield } from './metafields.js';
import { mergeStoreSettingsObject, storeSettingsJson } from './settings-json.js';
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

/**
 * Serialize outbound metafield writes with a transaction-scoped database lock.
 *
 * The lock deliberately spans the Shopify call: unlike a Redis lease it cannot
 * expire while an unbounded network request is in flight, and Postgres releases
 * it automatically on commit, rollback, or connection loss. Each holder
 * re-reads the row after acquiring the lock, so a later PATCH mirrors the
 * complete latest config even if an earlier request began publishing first.
 */
async function publishLatestConfig(
  app: FastifyInstance,
  storeId: string,
  log: FastifyBaseLogger,
): Promise<boolean> {
  return app.db.transaction(async (tx) => {
    const lockKey = `shopify-widget-config:${storeId}`;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);

    const [store] = await tx
      .select()
      .from(schema.shopifyStores)
      .where(eq(schema.shopifyStores.id, storeId))
      .limit(1);
    if (!store || store.uninstalledAt) throw new AppError('FORBIDDEN', 403, 'Store not installed');

    return publishConfig(app, store, log);
  });
}

export async function shopifyWidgetConfigRoutes(app: FastifyInstance) {
  app.patch(
    '/v1/shopify/widget-config',
    { preValidation: app.requireShopifySession, schema: { body: ShopifyWidgetConfigPatch } },
    async (req) => {
      const authenticatedStore = req.shopifyStore as Store;
      const body = req.body as ShopifyWidgetConfigPatch;
      let settings = storeSettingsJson();
      if (body.theme)
        settings = mergeStoreSettingsObject(settings, ['widget', 'theme'], body.theme);
      if (body.copy) settings = mergeStoreSettingsObject(settings, ['widget', 'copy'], body.copy);
      if (body.behavior) {
        settings = mergeStoreSettingsObject(settings, ['widget', 'behavior'], body.behavior);
      }

      const [updated] = await app.db
        .update(schema.shopifyStores)
        .set({ settings, updatedAt: new Date() })
        .where(eq(schema.shopifyStores.id, authenticatedStore.id))
        .returning({ settings: schema.shopifyStores.settings });
      if (!updated) throw new AppError('FORBIDDEN', 403, 'Store not installed');

      // Postgres is authoritative and already committed. The metafield is a
      // cache, so a failed mirror is reported as synced:false on a 200 — a 5xx
      // here would tell the merchant their copy was lost when it was not.
      const synced = await publishLatestConfig(app, authenticatedStore.id, req.log);
      const widget: ShopifyWidgetConfig = updated.settings.widget ?? {};

      req.log.info(
        { storeId: authenticatedStore.id, changed: Object.keys(body), synced },
        'shopify widget config updated',
      );
      return { widget, synced };
    },
  );

  app.post(
    '/v1/shopify/widget-config/republish',
    { preValidation: app.requireShopifySession },
    async (req) => {
      const authenticatedStore = req.shopifyStore as Store;
      const synced = await publishLatestConfig(app, authenticatedStore.id, req.log);
      req.log.info({ storeId: authenticatedStore.id, synced }, 'shopify widget config republished');
      return { synced };
    },
  );
}
