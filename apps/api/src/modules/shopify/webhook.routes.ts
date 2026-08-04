import { schema } from '@aivastra/db';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError } from '../../lib/errors.js';
import { collectShopperData, type RedactResult, redactShopperData } from './gdpr.js';
import { enqueueSync, verifyWebhookHmac } from './service.js';

/**
 * A GDPR redaction that only half-completed must not look like a success.
 *
 * Retention has an hourly sweeper that naturally retries whatever it left
 * behind; redaction has no such loop — nothing revisits a subject whose object
 * deletes failed. So a non-zero `incomplete` is logged at `error`, with the
 * store id and topic, to be alertable and greppable against the 30-day
 * statutory deadline. Building an actual retry/reconciliation mechanism is out
 * of scope here; an operator has to see it and act.
 */
function logRedactResult(
  req: FastifyRequest,
  topic: string,
  shopDomain: string | undefined,
  storeId: string,
  result: RedactResult,
  message: string,
): void {
  if (result.incomplete > 0) {
    req.log.error(
      { topic, shopDomain, storeId, removed: result.removed, incomplete: result.incomplete },
      `gdpr: ${message} INCOMPLETE — objects left undeleted, manual follow-up required`,
    );
    return;
  }
  req.log.info({ topic, shopDomain, storeId, removed: result.removed }, `gdpr: ${message}`);
}

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
      const payload = JSON.parse(raw.toString() || '{}') as {
        id?: number;
        customer?: { id?: number; email?: string };
      };

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
          case 'customers_redact': {
            if (store) {
              const result = await redactShopperData(app, store.id, {
                shopifyCustomerId: payload.customer?.id ?? null,
                email: payload.customer?.email ?? null,
              });
              logRedactResult(req, topic, shopDomain, store.id, result, 'shopper data redacted');
            }
            break;
          }
          case 'shop_redact': {
            if (store) {
              const result = await redactShopperData(app, store.id, { matchAll: true });
              logRedactResult(req, topic, shopDomain, store.id, result, 'store data purged');
            }
            break;
          }
          case 'customers_data_request': {
            if (store) {
              const found = await collectShopperData(app, store.id, {
                shopifyCustomerId: payload.customer?.id ?? null,
                email: payload.customer?.email ?? null,
              });
              // Shopify allows 30 days to respond and expects the merchant to
              // relay the data; log enough to fulfil it without dumping PII
              // into the log itself.
              req.log.info(
                { topic, shopDomain, shopperIds: found.shopperIds },
                'gdpr: data request received',
              );
            }
            break;
          }
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
