import { schema } from '@aivastra/db';
import { isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { shopifyAdminFetch } from './service.js';
import { getValidAccessToken } from './token.js';
import { buildWebhookTopicMap } from './webhook.routes.js';

/**
 * Backstop for `shopifyRegisterWebhooks` (webhook.routes.ts) — that call is
 * best-effort at install/reauth time, and a per-topic failure there is only
 * logged, never retried on its own. A store can end up with some or all of
 * its subscriptions missing (a transient 5xx during install, a webhook
 * registered before a topic existed in the map, ...) with nothing surfacing
 * it until a merchant notices try-on routing silently going stale. This
 * mirrors startProductResyncScheduler's role as the backstop for a dropped
 * products/delete delivery — same idea, one layer up: this catches the
 * subscription never existing at all.
 */
async function reconcileStoreWebhooks(
  app: FastifyInstance,
  store: typeof schema.shopifyStores.$inferSelect,
): Promise<void> {
  const token = await getValidAccessToken(app, store);
  const res = await shopifyAdminFetch(store.shopDomain, token, '/webhooks.json');
  if (!res.ok) {
    app.log.warn(
      { storeId: store.id, status: res.status },
      'webhook reconcile: failed to list registered webhooks',
    );
    return;
  }

  const body = (await res.json()) as { webhooks: Array<{ topic: string }> };
  const registeredTopics = new Set(body.webhooks.map((w) => w.topic));
  const expected = buildWebhookTopicMap(app.env.SHOPIFY_APP_URL ?? '');
  const missing = Object.entries(expected).filter(([topic]) => !registeredTopics.has(topic));
  if (missing.length === 0) return;

  app.log.warn(
    { storeId: store.id, shopDomain: store.shopDomain, missingTopics: missing.map(([t]) => t) },
    'webhook reconcile: store missing webhook subscriptions — re-registering',
  );
  for (const [topic, address] of missing) {
    try {
      const registerRes = await shopifyAdminFetch(store.shopDomain, token, '/webhooks.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhook: { topic, address, format: 'json' } }),
      });
      if (!registerRes.ok) {
        const errBody = await registerRes.text().catch(() => '');
        app.log.error(
          { storeId: store.id, topic, status: registerRes.status, errBody },
          'webhook reconcile: re-registration failed',
        );
      }
    } catch (err) {
      app.log.error({ err, storeId: store.id, topic }, 'webhook reconcile: re-registration threw');
    }
  }
}

export async function runWebhookReconcileTick(app: FastifyInstance): Promise<void> {
  const stores = await app.db
    .select()
    .from(schema.shopifyStores)
    .where(isNull(schema.shopifyStores.uninstalledAt));

  for (const store of stores) {
    try {
      await reconcileStoreWebhooks(app, store);
    } catch (err) {
      app.log.error({ err, storeId: store.id }, 'webhook reconcile: tick failed for store');
    }
  }
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * Call once after `app.listen(...)`, alongside the other shopify schedulers —
 * mirrors their "start once, get a stop function back" shape.
 */
export function startWebhookRegistrationReconciler(
  app: FastifyInstance,
  intervalMs: number = HOUR_MS,
): () => void {
  const timer = setInterval(() => {
    void runWebhookReconcileTick(app).catch((err) => {
      app.log.error({ err }, 'webhook reconcile tick failed');
    });
  }, intervalMs);
  return () => clearInterval(timer);
}
