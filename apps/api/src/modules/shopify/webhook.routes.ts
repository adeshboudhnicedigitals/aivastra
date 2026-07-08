import { schema } from '@aivastra/db';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { AppError } from '../../lib/errors.js';
import { enqueueSync, verifyWebhookHmac } from './service.js';

// NOTE: `shopifyRegisterWebhooks` on FastifyInstance is declared once in
// `auth.routes.ts` (`declare module 'fastify' { interface FastifyInstance { ... } }`).
// Do not re-declare it here — TypeScript module augmentation is global, so a
// second declaration site is unnecessary and risks drifting out of sync with
// the original (e.g. differing parameter names/optionality).

export async function shopifyWebhookRoutes(app: FastifyInstance) {
  // Capture raw body for HMAC (scoped to this encapsulated plugin instance only,
  // since this is a plain async function registered via app.register() — Fastify
  // gives it its own encapsulation context, so this parser does not leak to
  // sibling/parent routes that still use the default JSON parser).
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, body); // hand the raw Buffer to handlers as req.body
  });

  const topics = [
    'app_uninstalled',
    'app_subscriptions_update',
    'products_update',
    'products_delete',
    'customers_data_request',
    'customers_redact',
    'shop_redact',
  ] as const;

  for (const topic of topics) {
    app.post(`/v1/shopify/webhooks/${topic}`, async (req, reply) => {
      const raw = req.body as Buffer;
      const hmac = req.headers['x-shopify-hmac-sha256'] as string | undefined;
      if (!verifyWebhookHmac(raw, hmac ?? '', app.env.SHOPIFY_API_SECRET ?? '')) {
        throw new AppError('UNAUTHORIZED', 401, 'bad webhook hmac');
      }
      const shopDomain = req.headers['x-shopify-shop-domain'] as string | undefined;
      const payload = JSON.parse(raw.toString() || '{}') as { id?: number };

      // Post-processing here is fast local work (a 1-2 row Postgres UPDATE or a
      // Redis XADD), never a slow outbound call — so we await it before
      // responding instead of deferring it to a fire-and-forget continuation.
      // That avoids both a race (tests/observers reading DB state right after
      // the 200) and a reliability gap (crash between send() and the
      // continuation finishing would silently drop the post-processing, and
      // Shopify won't retry since it already got a 200).
      try {
        const [store] = shopDomain
          ? await app.db
              .select()
              .from(schema.shopifyStores)
              .where(eq(schema.shopifyStores.shopDomain, shopDomain))
              .limit(1)
          : [undefined];

        switch (topic) {
          case 'app_uninstalled':
            if (store) {
              await app.db
                .update(schema.shopifyStores)
                .set({ uninstalledAt: new Date() })
                .where(eq(schema.shopifyStores.id, store.id));
              await app.db
                .update(schema.widgetClients)
                .set({ isActive: false })
                .where(eq(schema.widgetClients.id, store.widgetClientId));
            }
            break;
          case 'products_update':
            if (store)
              await enqueueSync(app.redis, {
                storeId: store.id,
                mode: 'product',
                shopifyProductId: payload.id,
              });
            break;
          case 'products_delete':
            if (store && payload.id != null) {
              await app.db
                .update(schema.shopifyProductGarments)
                .set({ status: 'deleted' })
                .where(
                  and(
                    eq(schema.shopifyProductGarments.storeId, store.id),
                    eq(schema.shopifyProductGarments.shopifyProductId, payload.id),
                  ),
                );
            }
            break;
          case 'customers_redact':
          case 'shop_redact':
            // We store no customer PII beyond transient photos; purge store R2 assets on shop_redact.
            req.log.info({ topic, shopDomain }, 'gdpr webhook acknowledged');
            break;
          case 'customers_data_request':
            req.log.info({ topic, shopDomain }, 'gdpr data request — no stored customer data');
            break;
          case 'app_subscriptions_update':
            req.log.info({ topic, shopDomain }, 'subscription updated');
            break;
        }
      } catch (err) {
        req.log.error({ err, topic }, 'webhook post-processing failed');
      }

      // Shopify shouldn't get a 4xx/5xx for a webhook it delivered correctly
      // just because our internal post-processing had a hiccup — the catch
      // above already logs the error and swallows it, so we always reach here.
      reply.code(200).send({ ok: true });
    });
  }
}

// Wrapped in fp() (matching every other decorator plugin in this codebase —
// see plugins/db.ts, plugins/redis.ts, plugins/auth.ts): without it, this would
// be registered as a plain function and get its own encapsulated child context,
// so `app.decorate('shopifyRegisterWebhooks', ...)` would only be visible inside
// that context — NOT to the sibling `shopifyAuthRoutes` context that actually
// calls `app.shopifyRegisterWebhooks?.()`. Because the call site uses optional
// chaining, that failure mode is silent (webhook registration just never fires).
export const registerWebhooksDecorator = fp(async (app: FastifyInstance) => {
  app.decorate('shopifyRegisterWebhooks', async (shop: string, token: string) => {
    const base = `${app.env.SHOPIFY_APP_URL}/v1/shopify/webhooks`;
    const map: Record<string, string> = {
      'app/uninstalled': `${base}/app_uninstalled`,
      'app_subscriptions/update': `${base}/app_subscriptions_update`,
      'products/update': `${base}/products_update`,
      'products/delete': `${base}/products_delete`,
      'customers/data_request': `${base}/customers_data_request`,
      'customers/redact': `${base}/customers_redact`,
      'shop/redact': `${base}/shop_redact`,
    };
    for (const [topic, address] of Object.entries(map)) {
      await fetch(`https://${shop}/admin/api/2024-01/webhooks.json`, {
        method: 'POST',
        headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhook: { topic, address, format: 'json' } }),
      }).catch((err) => app.log.error({ err, topic }, 'webhook registration failed'));
    }
  });
});
