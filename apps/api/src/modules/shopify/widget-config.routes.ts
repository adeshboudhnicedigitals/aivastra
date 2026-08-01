import { randomUUID } from 'node:crypto';
import type { ShopifyWidgetConfig } from '@aivastra/db';
import { schema } from '@aivastra/db';
import { ShopifyWidgetConfigPatch } from '@aivastra/types';
import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { AppError } from '../../lib/errors.js';
import { writeWidgetConfigMetafield } from './metafields.js';
import { mergeStoreSettingsObject, storeSettingsJson } from './settings-json.js';
import { getValidAccessToken } from './token.js';

type Store = typeof schema.shopifyStores.$inferSelect;
type PublishedConfig = { widget: ShopifyWidgetConfig; synced: boolean };

// The fetch timeout is intentionally well below the lease lifetime. That
// leaves room for response parsing and the compare-and-delete release while
// ensuring an in-flight Shopify call cannot outlive its serialization lock.
const SHOPIFY_REQUEST_TIMEOUT_MS = 10_000;
const WIDGET_CONFIG_LOCK_TTL_MS = 30_000;
const WIDGET_CONFIG_LOCK_WAIT_MS = 250;
const WIDGET_CONFIG_LOCK_ATTEMPTS = 120;

const COMPARE_AND_DELETE_LOCK = `
  if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('del', KEYS[1])
  end
  return 0
`;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchShopifyWithTimeout(...args: Parameters<typeof fetch>): Promise<Response> {
  const [input, init] = args;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SHOPIFY_REQUEST_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function withWidgetConfigPublishLock<T>(
  app: FastifyInstance,
  storeId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const lockKey = `shopify:widget-config:${storeId}`;
  const owner = randomUUID();

  for (let attempt = 0; attempt < WIDGET_CONFIG_LOCK_ATTEMPTS; attempt++) {
    const held = await app.redis.set(lockKey, owner, 'PX', WIDGET_CONFIG_LOCK_TTL_MS, 'NX');
    if (held) {
      try {
        return await fn();
      } finally {
        await app.redis.eval(COMPARE_AND_DELETE_LOCK, 1, lockKey, owner).catch(() => {
          // A TTL bounds a failed release. Compare-and-delete never clears a
          // successor's lock if this owner has already expired.
        });
      }
    }
    await sleep(WIDGET_CONFIG_LOCK_WAIT_MS);
  }

  throw new AppError('SHOPIFY', 503, 'Widget config publish in progress, retry shortly');
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
  store: Store,
  accessToken: string,
  log: FastifyBaseLogger,
): Promise<boolean> {
  return writeWidgetConfigMetafield(
    store.shopDomain,
    accessToken,
    store.shopifyShopId,
    store.settings.widget ?? {},
    log,
    fetchShopifyWithTimeout,
  );
}

/**
 * Serialize outbound metafield writes without holding a pooled DB connection.
 *
 * Token refresh runs before the lock because it can itself need database work.
 * Once locked, the bounded Shopify request completes well inside the lease
 * lifetime; a fresh row read supplies the exact config sent to Shopify.
 */
async function publishLatestConfig(
  app: FastifyInstance,
  storeId: string,
  log: FastifyBaseLogger,
): Promise<PublishedConfig> {
  const tokenStore = await getCurrentStore(app, storeId);
  const accessToken = await getValidAccessToken(app, tokenStore);

  return withWidgetConfigPublishLock(app, storeId, async () => {
    const store = await getCurrentStore(app, storeId);
    const widget = store.settings.widget ?? {};
    const synced = await publishConfig(store, accessToken, log);
    return { widget, synced };
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
      const { widget, synced } = await publishLatestConfig(app, authenticatedStore.id, req.log);

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
      const { synced } = await publishLatestConfig(app, authenticatedStore.id, req.log);
      req.log.info({ storeId: authenticatedStore.id, synced }, 'shopify widget config republished');
      return { synced };
    },
  );
}
