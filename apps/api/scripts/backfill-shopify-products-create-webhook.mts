/**
 * One-off backfill: registers the products/create webhook subscription with
 * Shopify for every currently-installed store.
 *
 * Why this is needed: the app never handled products/create (only
 * products/update and products/delete), so a brand-new Shopify product never
 * entered shopify_product_garments automatically. That gap is now closed in
 * webhook.routes.ts (registerWebhooksDecorator's topic map + the switch in
 * shopifyWebhookRoutes) — but shopifyRegisterWebhooks only runs at
 * install/reinstall time (plugins/shopify-auth.ts: `!store || store.uninstalledAt`),
 * so the new topic only gets registered with Shopify for a NEW install going
 * forward. Every store that installed before this fix keeps missing the
 * subscription until it reinstalls, which merchants essentially never do on
 * their own — this script closes that gap without requiring one.
 *
 * Safe to re-run: Shopify answers a repeat registration for the same
 * topic+address with a 422 "Address for this topic has already been taken",
 * which is logged and counted as ok, not fatal. It also only ever registers
 * this one topic — it does not touch the other five webhook.routes.ts
 * registers, so it can't disturb an existing subscription.
 *
 * Usage (run once after deploying the products/create fix):
 *   pnpm backfill:shopify-products-create-webhook                        # every installed store
 *   pnpm backfill:shopify-products-create-webhook my-shop.myshopify.com   # one store
 *
 * Requires env: DATABASE_URL, REDIS_URL, SHOPIFY_APP_URL, SHOPIFY_TOKEN_ENC_KEY,
 * and whatever getValidAccessToken needs to refresh a near-expiry token.
 */

import { createDb, eq, isNull, schema } from '@aivastra/db';
import Redis from 'ioredis';

const shopArg = process.argv[2];

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

const { db, close } = createDb(process.env.DATABASE_URL ?? '');

try {
  const stores = await db
    .select()
    .from(schema.shopifyStores)
    .where(
      shopArg
        ? eq(schema.shopifyStores.shopDomain, shopArg)
        : isNull(schema.shopifyStores.uninstalledAt),
    );

  if (stores.length === 0) {
    console.error('no installed store(s) found', { shopArg });
    process.exit(2);
  }

  // Imported lazily and by path, same as scripts/check-billing-api-enabled.mts:
  // this is an ops tool run from the repo root, and pulling in the api module
  // graph at the top would make a missing env var fail before the friendlier
  // checks above ever run.
  const { getValidAccessToken } = await import('../src/modules/shopify/token.js');
  const { shopifyAdminFetch } = await import('../src/modules/shopify/service.js');

  const appUrl = requireEnv('SHOPIFY_APP_URL');
  const address = `${appUrl}/v1/shopify/webhooks/products_create`;

  // getValidAccessToken wants a Fastify-instance-shaped object for its env, db,
  // logger and redis — redis included because a token close to expiry is
  // refreshed under a Redis lock.
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');
  const app = {
    env: process.env,
    db,
    redis,
    log: { info: console.log, warn: console.warn, error: console.error },
  } as never;

  let ok = 0;
  let failed = 0;
  try {
    for (const store of stores) {
      try {
        const token = await getValidAccessToken(app, store);
        const res = await shopifyAdminFetch(store.shopDomain, token, '/webhooks.json', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            webhook: { topic: 'products/create', address, format: 'json' },
          }),
        });
        if (res.ok) {
          console.log(`registered products/create for ${store.shopDomain}`);
          ok++;
          continue;
        }
        const body = await res.text().catch(() => '');
        if (res.status === 422 && /already been taken/i.test(body)) {
          console.log(`products/create already registered for ${store.shopDomain} — skipping`);
          ok++;
          continue;
        }
        console.error(`failed for ${store.shopDomain}: HTTP ${res.status} ${body}`);
        failed++;
      } catch (err) {
        console.error(
          `failed for ${store.shopDomain}:`,
          err instanceof Error ? err.message : String(err),
        );
        failed++;
      }
    }
  } finally {
    redis.disconnect();
  }

  console.log(`\nDONE: ${ok} ok, ${failed} failed (${stores.length} total)`);
  if (failed > 0) process.exitCode = 1;
} finally {
  await close();
}
