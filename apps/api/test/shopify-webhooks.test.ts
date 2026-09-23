import { createHmac } from 'node:crypto';
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { upsertShopifyStore } from '../src/modules/shopify/auth.routes.js';
import { buildTestApp, type TestApp } from './helpers/api.js';
import { type Containers, startContainers } from './helpers/containers.js';

const SECRET = 'shpss_hook_secret';
const ENC_KEY = Buffer.alloc(32, 3).toString('base64');
let c: Containers;
let app: TestApp;
let storeId: string;

function sign(raw: string) {
  return createHmac('sha256', SECRET).update(Buffer.from(raw)).digest('base64');
}

beforeAll(async () => {
  c = await startContainers();
  app = await buildTestApp(c, { SHOPIFY_API_SECRET: SECRET, SHOPIFY_TOKEN_ENC_KEY: ENC_KEY });
  const store = await upsertShopifyStore(
    app,
    {
      shopifyShopId: 999,
      shopDomain: 'w.myshopify.com',
      myshopifyDomain: 'w.myshopify.com',
      name: 'W',
      email: 'w@w.com',
    },
    'tok',
    'read_products',
  );
  storeId = store.id;
});
afterAll(async () => {
  await app?.close();
  await c?.stop();
});

describe('shopify webhooks', () => {
  it('rejects a bad HMAC', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/shopify/webhooks/app_uninstalled',
      headers: {
        'x-shopify-hmac-sha256': 'bad',
        'x-shopify-shop-domain': 'w.myshopify.com',
        'content-type': 'application/json',
      },
      payload: '{"id":999}',
    });
    expect(res.statusCode).toBe(401);
  });

  it('processes app/uninstalled: deactivates store and clears auto-refill', async () => {
    // Shopify cancels the subscription itself on uninstall and our
    // app_subscriptions/update subscription dies with the install, so nothing
    // else would ever clear these — a reinstall would show auto-refill ACTIVE
    // against a subscription that no longer exists.
    await app.db
      .update(schema.shopifyStores)
      .set({
        autorefillPackId: 'pack_10',
        autorefillTriggerCredits: 160,
        autorefillSubscriptionId: 'gid://shopify/AppSubscription/1',
        autorefillLineItemId: 'gid://shopify/AppSubscriptionLineItem/1',
        autorefillCappedAmountCents: 5000,
        autorefillStatus: 'ACTIVE',
      })
      .where(eq(schema.shopifyStores.id, storeId));

    const raw = '{"id":999}';
    const res = await app.inject({
      method: 'POST',
      url: '/v1/shopify/webhooks/app_uninstalled',
      headers: {
        'x-shopify-hmac-sha256': sign(raw),
        'x-shopify-shop-domain': 'w.myshopify.com',
        'content-type': 'application/json',
      },
      payload: raw,
    });
    expect(res.statusCode).toBe(200);
    const [store] = await app.db
      .select()
      .from(schema.shopifyStores)
      .where(eq(schema.shopifyStores.id, storeId));
    expect(store.uninstalledAt).not.toBeNull();
    expect(store.autorefillStatus).toBeNull();
    expect(store.autorefillSubscriptionId).toBeNull();
    expect(store.autorefillLineItemId).toBeNull();
    expect(store.autorefillPackId).toBeNull();
    expect(store.autorefillTriggerCredits).toBeNull();
    expect(store.autorefillCappedAmountCents).toBeNull();
  });

  it('processes products/update: enqueues a sync task', async () => {
    const raw = '{"id":555}';
    const res = await app.inject({
      method: 'POST',
      url: '/v1/shopify/webhooks/products_update',
      headers: {
        'x-shopify-hmac-sha256': sign(raw),
        'x-shopify-shop-domain': 'w.myshopify.com',
        'content-type': 'application/json',
      },
      payload: raw,
    });
    expect(res.statusCode).toBe(200);
    const len = await app.redis.xlen('shopify:sync');
    expect(len).toBeGreaterThan(0);
  });

  it('processes products/create: enqueues a sync task', async () => {
    // A brand-new product fires products/create, not products/update — this
    // topic must be handled the same way (enqueue a 'product' mode sync) or a
    // newly-created product never enters shopify_product_garments until the
    // merchant edits it or clicks "Sync now".
    const raw = '{"id":556}';
    const beforeLen = await app.redis.xlen('shopify:sync');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/shopify/webhooks/products_create',
      headers: {
        'x-shopify-hmac-sha256': sign(raw),
        'x-shopify-shop-domain': 'w.myshopify.com',
        'content-type': 'application/json',
      },
      payload: raw,
    });
    expect(res.statusCode).toBe(200);
    const afterLen = await app.redis.xlen('shopify:sync');
    expect(afterLen).toBeGreaterThan(beforeLen);
  });

  it('processes collections/update: skips a collection no rule references', async () => {
    const beforeLen = await app.redis.xlen('shopify:sync');
    const raw = JSON.stringify({ id: 777, title: 'Random Lookbook' });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/shopify/webhooks/collections_update',
      headers: {
        'x-shopify-hmac-sha256': sign(raw),
        'x-shopify-shop-domain': 'w.myshopify.com',
        'content-type': 'application/json',
      },
      payload: raw,
    });
    expect(res.statusCode).toBe(200);
    const afterLen = await app.redis.xlen('shopify:sync');
    expect(afterLen).toBe(beforeLen);
  });

  it('processes collections/update: enqueues a refreshing collection sync when a rule routes by this title', async () => {
    const [wf] = await app.db
      .insert(schema.workflowTemplates)
      .values({
        slug: 'webhook-test-wf',
        label: 'Test WF',
        jsonContent: {},
        faceNodeId: 'x',
        poseNodeId: 'x',
        bgNodeId: 'x',
        upperNodeIds: [],
        facePhasePromptNode: 'x',
        garmentPhasePromptNode: 'x',
        workflowType: 'tryon',
      })
      .returning();
    const [basket] = await app.db
      .insert(schema.shopifyFunnelTemplates)
      .values({ slug: 'webhook-test-basket', label: 'Sarees', workflowTemplateId: wf.id })
      .returning();
    await app.db.insert(schema.shopifyFunnelRules).values({
      storeId,
      funnelTemplateId: basket.id,
      conditions: [{ field: 'collections', operator: 'equals', value: 'sarees' }],
      priority: 0,
    });

    const raw = JSON.stringify({ id: 778, title: 'Sarees' });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/shopify/webhooks/collections_update',
      headers: {
        'x-shopify-hmac-sha256': sign(raw),
        'x-shopify-shop-domain': 'w.myshopify.com',
        'content-type': 'application/json',
      },
      payload: raw,
    });
    expect(res.statusCode).toBe(200);

    const entries = await app.redis.xrevrange('shopify:sync', '+', '-', 'COUNT', 1);
    const [, fields] = entries[0];
    const task = JSON.parse(fields[fields.indexOf('task') + 1]);
    expect(task).toMatchObject({
      storeId,
      mode: 'collection',
      shopifyCollectionId: 778,
      refreshProducts: true,
    });
  });

  it('responds 200 to GDPR customers/redact', async () => {
    const raw = '{"shop_id":999,"customer":{"id":1}}';
    const res = await app.inject({
      method: 'POST',
      url: '/v1/shopify/webhooks/customers_redact',
      headers: {
        'x-shopify-hmac-sha256': sign(raw),
        'x-shopify-shop-domain': 'w.myshopify.com',
        'content-type': 'application/json',
      },
      payload: raw,
    });
    expect(res.statusCode).toBe(200);
  });
});
