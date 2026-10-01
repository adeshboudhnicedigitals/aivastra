import { createHmac } from 'node:crypto';
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp } from '../helpers/api.js';
import { startContainers } from '../helpers/containers.js';

const SECRET = 'app-proxy-test-secret';

function signAppProxyQuery(params: Record<string, string>): Record<string, string> {
  const msg = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('');
  const signature = createHmac('sha256', SECRET).update(msg).digest('hex');
  return { ...params, signature };
}

// SEC-7.1: end-to-end proof the App Proxy path works through the real Fastify
// app, not just the mocked decorator unit tests in shopify-widget-auth.test.ts.
describe('shopify customer routes — App Proxy path', () => {
  let ctx: Awaited<ReturnType<typeof startContainers>>;
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  beforeAll(async () => {
    ctx = await startContainers();
    app = await buildTestApp(ctx, { SHOPIFY_API_SECRET: SECRET });
  });
  afterAll(async () => {
    await app.close();
    await ctx.stop();
  });

  async function seedStore() {
    const [store] = await app.db
      .insert(schema.shopifyStores)
      .values({
        shopDomain: `proxy-test-${Date.now()}-${Math.random()}.myshopify.com`,
        shopifyShopId: Date.now(),
        accessToken: 'enc',
        scope: 'read_products',
      })
      .returning();
    return store;
  }

  it('rejects a proxy request with no signature', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/shopify/proxy/customer/presign',
      payload: { contentType: 'image/jpeg', contentLength: 1024 },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a proxy request with a tampered signature', async () => {
    const store = await seedStore();
    const query = signAppProxyQuery({
      shop: store.shopDomain,
      timestamp: String(Math.floor(Date.now() / 1000)),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/shopify/proxy/customer/presign',
      query: { ...query, shop: 'evil.myshopify.com' },
      payload: { contentType: 'image/jpeg', contentLength: 1024 },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a proxy request with an expired timestamp', async () => {
    const store = await seedStore();
    const query = signAppProxyQuery({
      shop: store.shopDomain,
      timestamp: String(Math.floor(Date.now() / 1000) - 3600),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/shopify/proxy/customer/presign',
      query,
      payload: { contentType: 'image/jpeg', contentLength: 1024 },
    });
    expect(res.statusCode).toBe(401);
  });

  it('accepts a validly signed, fresh proxy request and resolves the correct store', async () => {
    const store = await seedStore();
    const query = signAppProxyQuery({
      shop: store.shopDomain,
      timestamp: String(Math.floor(Date.now() / 1000)),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/shopify/proxy/customer/presign',
      query,
      payload: { contentType: 'image/jpeg', contentLength: 1024 },
    });
    expect(res.statusCode).toBe(200);
    const { r2Key } = res.json() as { r2Key: string };
    expect(r2Key).toContain(store.id);
  });

  it('a proxy-signed request for one store cannot be replayed against another store', async () => {
    const storeA = await seedStore();
    const storeB = await seedStore();
    const query = signAppProxyQuery({
      shop: storeA.shopDomain,
      timestamp: String(Math.floor(Date.now() / 1000)),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/shopify/proxy/customer/presign',
      query,
      payload: { contentType: 'image/jpeg', contentLength: 1024 },
    });
    expect(res.statusCode).toBe(200);
    const { r2Key } = res.json() as { r2Key: string };
    expect(r2Key).toContain(storeA.id);
    expect(r2Key).not.toContain(storeB.id);
  });
});

// Onboarding's theme step is finished by the widget's first request on a live
// product page, not by a merchant button — see markThemeEmbedSeen.
describe('shopify /enabled — app embed detection', () => {
  let ctx: Awaited<ReturnType<typeof startContainers>>;
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  beforeAll(async () => {
    ctx = await startContainers();
    app = await buildTestApp(ctx, { SHOPIFY_API_SECRET: SECRET });
  });
  afterAll(async () => {
    await app.close();
    await ctx.stop();
  });

  async function seedStore() {
    const [store] = await app.db
      .insert(schema.shopifyStores)
      .values({
        shopDomain: `embed-test-${Date.now()}-${Math.random()}.myshopify.com`,
        shopifyShopId: Date.now(),
        accessToken: 'enc',
        scope: 'read_products',
      })
      .returning();
    return store;
  }

  async function settingsOf(storeId: string) {
    const [row] = await app.db
      .select({ settings: schema.shopifyStores.settings })
      .from(schema.shopifyStores)
      .where(eq(schema.shopifyStores.id, storeId));
    return row.settings ?? {};
  }

  function ping(shop: string, extra: Record<string, string> = {}) {
    return app.inject({
      method: 'GET',
      url: '/v1/shopify/proxy/customer/products/1/enabled',
      query: signAppProxyQuery({
        shop,
        timestamp: String(Math.floor(Date.now() / 1000)),
        ...extra,
      }),
    });
  }

  // The write is fire-and-forget, so give it a moment to land.
  async function settle() {
    await new Promise((r) => setTimeout(r, 300));
  }

  it('marks the embed as seen on a signed live product-page view', async () => {
    const store = await seedStore();
    expect((await ping(store.shopDomain)).statusCode).toBe(200);
    await settle();
    expect(await settingsOf(store.id)).toMatchObject({
      themeEmbedConfirmed: true,
      themeBlockConfirmed: true,
    });
  });

  it('ignores the theme editor / unpublished-theme preview (dm=1)', async () => {
    const store = await seedStore();
    expect((await ping(store.shopDomain, { dm: '1' })).statusCode).toBe(200);
    await settle();
    expect(await settingsOf(store.id)).not.toHaveProperty('themeEmbedConfirmed');
  });

  it('ignores the legacy X-Widget-Key path, whose key is public in the page HTML', async () => {
    const store = await seedStore();
    const res = await app.inject({
      method: 'GET',
      url: '/v1/shopify/customer/products/1/enabled',
      headers: { 'x-widget-key': store.storeKey },
    });
    expect(res.statusCode).toBe(200);
    await settle();
    expect(await settingsOf(store.id)).not.toHaveProperty('themeEmbedConfirmed');
  });

  it('leaves other settings alone when it marks the embed', async () => {
    const store = await seedStore();
    await app.db
      .update(schema.shopifyStores)
      .set({ settings: { retention: { resultDays: 90 } } })
      .where(eq(schema.shopifyStores.id, store.id));
    await ping(store.shopDomain);
    await settle();
    expect(await settingsOf(store.id)).toMatchObject({
      retention: { resultDays: 90 },
      themeEmbedConfirmed: true,
    });
  });
});
