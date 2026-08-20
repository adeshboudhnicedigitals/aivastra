import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';
import { signSessionToken } from '../helpers/shopify-session.js';

const API_SECRET = 'test-secret';
const API_KEY = 'test-key';

describe('PATCH /v1/shopify/billing/payg-cap', () => {
  let c: Containers;
  let app: TestApp;
  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c, { SHOPIFY_API_SECRET: API_SECRET, SHOPIFY_API_KEY: API_KEY });
  }, 60000);
  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  async function seedStore() {
    const [store] = await app.db
      .insert(schema.shopifyStores)
      .values({
        shopDomain: `payg-cap-route-${Date.now()}-${Math.random()}.myshopify.com`,
        shopifyShopId: Date.now(),
        accessToken: 'enc',
        scope: 'read_products',
        billingMode: 'usage',
      })
      .returning();
    return store!;
  }

  it('rejects a cap below the minimum', async () => {
    const store = await seedStore();
    const token = signSessionToken(store.shopDomain, API_SECRET, API_KEY);
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/shopify/billing/payg-cap',
      headers: { authorization: `Bearer ${token}` },
      payload: { spendCapUsdCents: 100 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('updates the store cap for an authenticated usage-mode store', async () => {
    const store = await seedStore();
    const token = signSessionToken(store.shopDomain, API_SECRET, API_KEY);
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/shopify/billing/payg-cap',
      headers: { authorization: `Bearer ${token}` },
      payload: { spendCapUsdCents: 2500 },
    });
    expect(res.statusCode).toBe(200);
    const [updated] = await app.db
      .select()
      .from(schema.shopifyStores)
      .where(eq(schema.shopifyStores.id, store.id));
    expect(updated?.paygSpendCapUsdCents).toBe(2500);
  });
});
