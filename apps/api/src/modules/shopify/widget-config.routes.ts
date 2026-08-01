import type { ShopifyWidgetConfig } from '@aivastra/db';
import { schema } from '@aivastra/db';
import { ShopifyWidgetConfigPatch } from '@aivastra/types';
import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { AppError } from '../../lib/errors.js';
import { writeWidgetConfigMetafield } from './metafields.js';
import { getValidAccessToken } from './token.js';

type Store = typeof schema.shopifyStores.$inferSelect;

const WIDGET_CONFIG_LOCK_TTL_S = 30;
const WIDGET_CONFIG_LOCK_WAIT_MS = 250;
const WIDGET_CONFIG_LOCK_ATTEMPTS = 20;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Serializes config reads, writes, and Shopify mirrors for one store.
 *
 * `requireShopifySession` intentionally supplies a request-start snapshot for
 * authentication. It cannot safely be used for read-modify-write config
 * updates: two requests can authenticate against the same snapshot and the
 * later write then erases the earlier one. Holding this cross-process Redis
 * lease through the metafield write also means an older mirror cannot complete
 * after a newer one and make Liquid read stale config.
 */
async function withWidgetConfigLock<T>(
  app: FastifyInstance,
  storeId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const lockKey = `shopify:widget-config:${storeId}`;

  for (let attempt = 0; attempt < WIDGET_CONFIG_LOCK_ATTEMPTS; attempt++) {
    const held = await app.redis.set(lockKey, '1', 'EX', WIDGET_CONFIG_LOCK_TTL_S, 'NX');
    if (held) {
      try {
        return await fn();
      } finally {
        await app.redis.del(lockKey).catch(() => {
          // The lease TTL makes a failed release temporary rather than permanent.
        });
      }
    }
    await sleep(WIDGET_CONFIG_LOCK_WAIT_MS);
  }

  throw new AppError('SHOPIFY', 503, 'Widget config update in progress, retry shortly');
}

async function getCurrentStore(app: FastifyInstance, storeId: string): Promise<Store> {
  const [store] = await app.db
    .select()
    .from(schema.shopifyStores)
    .where(eq(schema.shopifyStores.id, storeId))
    .limit(1);
  if (!store || store.uninstalledAt) throw new AppError('FORBIDDEN', 403, 'Store not installed');
  return store;
}

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
      const authenticatedStore = req.shopifyStore as Store;
      const body = req.body as ShopifyWidgetConfigPatch;
      return withWidgetConfigLock(app, authenticatedStore.id, async () => {
        const store = await getCurrentStore(app, authenticatedStore.id);
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
      });
    },
  );

  app.post(
    '/v1/shopify/widget-config/republish',
    { preValidation: app.requireShopifySession },
    async (req) => {
      const authenticatedStore = req.shopifyStore as Store;
      return withWidgetConfigLock(app, authenticatedStore.id, async () => {
        const store = await getCurrentStore(app, authenticatedStore.id);
        const synced = await publishConfig(app, store, req.log);
        req.log.info({ storeId: store.id, synced }, 'shopify widget config republished');
        return { synced };
      });
    },
  );
}
