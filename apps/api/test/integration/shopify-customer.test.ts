import { schema } from '@aivastra/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminAuthHeader } from '../helpers/admin.js';
import { buildTestApp } from '../helpers/api.js';
import { startContainers } from '../helpers/containers.js';

describe('shopify customer routes', () => {
  let ctx: Awaited<ReturnType<typeof startContainers>>;
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  beforeAll(async () => {
    ctx = await startContainers();
    app = await buildTestApp(ctx);
  });
  afterAll(async () => {
    await app.close();
    await ctx.stop();
  });

  async function seedStore() {
    const [store] = await app.db
      .insert(schema.shopifyStores)
      .values({
        shopDomain: `test-${Date.now()}.myshopify.com`,
        shopifyShopId: Date.now(),
        accessToken: 'enc',
        scope: 'read_products',
      })
      .returning();
    return store;
  }

  it('rejects presign without a store key', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/shopify/customer/presign',
      payload: { contentType: 'image/jpeg', contentLength: 1024 },
    });
    expect(res.statusCode).toBe(401);
  });

  it('mints an account link code for an authenticated app user, then exchanges it for a store-scoped token', async () => {
    const store = await seedStore();
    const { authorization } = await adminAuthHeader(app, 'SUPER_ADMIN');

    const linkRes = await app.inject({
      method: 'POST',
      url: '/v1/shopify/customer/account/link',
      headers: { authorization },
    });
    expect(linkRes.statusCode).toBe(200);
    const { code } = linkRes.json() as { code: string };

    const exchangeRes = await app.inject({
      method: 'POST',
      url: '/v1/shopify/customer/account/exchange',
      headers: { 'x-widget-key': store.storeKey },
      payload: { code },
    });
    expect(exchangeRes.statusCode).toBe(200);
    expect(exchangeRes.json()).toHaveProperty('token');

    const secondExchange = await app.inject({
      method: 'POST',
      url: '/v1/shopify/customer/account/exchange',
      headers: { 'x-widget-key': store.storeKey },
      payload: { code },
    });
    expect(secondExchange.statusCode).toBe(401);
  });

  it('rejects job creation without an account token', async () => {
    const store = await seedStore();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/shopify/customer/jobs',
      headers: { 'x-widget-key': store.storeKey },
      payload: { customerPhotoKey: 'widget-inputs/x/photo.jpg', shopifyProductId: 1 },
    });
    expect(res.statusCode).toBe(401);
  });
});
