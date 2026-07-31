import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { upsertShopifyStore } from '../../src/modules/shopify/auth.routes.js';
import { buildTestApp } from '../helpers/api.js';
import { startContainers } from '../helpers/containers.js';
import { signSessionToken } from '../helpers/shopify-session.js';

const ENC_KEY = Buffer.alloc(32, 11).toString('base64');
const API_SECRET = 'test-secret';
const API_KEY = 'test-key';
let storeId: string;
let token: string;

describe('shopify settings routes', () => {
  let ctx: Awaited<ReturnType<typeof startContainers>>;
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  beforeAll(async () => {
    ctx = await startContainers();
    app = await buildTestApp(ctx, {
      SHOPIFY_TOKEN_ENC_KEY: ENC_KEY,
      SHOPIFY_API_SECRET: API_SECRET,
      SHOPIFY_API_KEY: API_KEY,
    });
    const store = await upsertShopifyStore(
      app,
      {
        shopifyShopId: 77,
        shopDomain: 'settings.myshopify.com',
        myshopifyDomain: 'settings.myshopify.com',
        name: 'S',
        email: 's@s.com',
      },
      'tok',
      'read_products',
    );
    storeId = store.id;
    token = signSessionToken('settings.myshopify.com', API_SECRET, API_KEY);
  });
  afterAll(async () => {
    await app.close();
    await ctx.stop();
  });

  it('authenticates before validating a settings patch', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/shopify/settings',
      payload: { limits: { storeDailyCap: 777 } },
    });
    expect(res.statusCode).toBe(401);

    const [row] = await app.db
      .select()
      .from(schema.shopifyStores)
      .where(eq(schema.shopifyStores.id, storeId));
    expect(row.settings).toEqual({});
  });

  it('rejects a limit value outside the allowed option set', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/shopify/settings',
      headers: { authorization: `Bearer ${token}` },
      payload: { limits: { storeDailyCap: 777 } },
    });
    expect(res.statusCode).toBe(400);
  });

  it('merges limits without clobbering unrelated settings', async () => {
    await app.db
      .update(schema.shopifyStores)
      .set({ settings: { themeBlockConfirmed: true, retention: { resultDays: 90 } } })
      .where(eq(schema.shopifyStores.id, storeId));

    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/shopify/settings',
      headers: { authorization: `Bearer ${token}` },
      payload: { limits: { storeDailyCap: 250, perShopperCap: 5, perShopperWindow: 'week' } },
    });
    expect(res.statusCode).toBe(200);

    const [row] = await app.db
      .select()
      .from(schema.shopifyStores)
      .where(eq(schema.shopifyStores.id, storeId));
    expect(row.settings.themeBlockConfirmed).toBe(true);
    expect(row.settings.limits?.storeDailyCap).toBe(250);
    expect(row.settings.limits?.perShopperWindow).toBe('week');
    expect(row.settings.retention?.resultDays).toBe(90);
  });

  it('accepts null to turn a limit back off', async () => {
    await app.inject({
      method: 'PATCH',
      url: '/v1/shopify/settings',
      headers: { authorization: `Bearer ${token}` },
      payload: { limits: { storeDailyCap: 100 } },
    });
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/shopify/settings',
      headers: { authorization: `Bearer ${token}` },
      payload: { limits: { storeDailyCap: null } },
    });
    expect(res.statusCode).toBe(200);
    const [row] = await app.db
      .select()
      .from(schema.shopifyStores)
      .where(eq(schema.shopifyStores.id, storeId));
    expect(row.settings.limits?.storeDailyCap).toBeNull();
  });
});
