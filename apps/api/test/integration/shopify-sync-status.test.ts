import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { upsertShopifyStore } from '../../src/modules/shopify/auth.routes.js';
import { markProductSyncRunning } from '../../src/modules/shopify/service.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';
import { signSessionToken } from '../helpers/shopify-session.js';

describe('Shopify product sync status progress', () => {
  let c: Containers;
  let app: TestApp;
  let storeId: string;
  let token: string;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c, {
      SHOPIFY_TOKEN_ENC_KEY: Buffer.alloc(32, 8).toString('base64'),
      SHOPIFY_API_SECRET: 'test-secret',
      SHOPIFY_API_KEY: 'test-key',
    });
    const store = await upsertShopifyStore(
      app,
      {
        shopifyShopId: 888,
        shopDomain: 'sync-status.myshopify.com',
        myshopifyDomain: 'sync-status.myshopify.com',
        name: 'Sync status',
        email: 'sync-status@example.com',
      },
      'tok',
      'read_products',
    );
    storeId = store.id;
    token = signSessionToken('sync-status.myshopify.com', 'test-secret', 'test-key');
  });

  // Rows from an earlier test carry timestamps after the next run's startedAt.
  beforeEach(async () => {
    await app.db
      .delete(schema.shopifyProductGarments)
      .where(eq(schema.shopifyProductGarments.storeId, storeId));
  });

  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  async function insertGarment(productId: number, syncedAt: Date, status = 'active') {
    await app.db.insert(schema.shopifyProductGarments).values({
      storeId,
      shopifyProductId: productId,
      r2Key: `shopify-garments/${storeId}/${productId}/garment.jpg`,
      title: `Product ${productId}`,
      status,
      enabled: true,
      syncedAt,
    });
  }

  async function getStatus() {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/shopify/products/sync/status',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    return response.json() as {
      state: string;
      total: number | null;
      imported: number;
    };
  }

  it('reports fresh imported rows and the Shopify total', async () => {
    await markProductSyncRunning(app.redis, storeId, 50);
    const status = JSON.parse((await app.redis.get(`shopify:sync:status:${storeId}`)) ?? '{}');
    await insertGarment(1, new Date(status.startedAt - 1000));
    await insertGarment(2, new Date(status.startedAt + 1000));
    await insertGarment(3, new Date(status.startedAt + 1000));
    await insertGarment(4, new Date(status.startedAt + 1000));
    const result = await getStatus();
    expect(result).toMatchObject({ state: 'running', total: 50, imported: 3 });
  });

  it('reports zero imported when the total is unavailable', async () => {
    await markProductSyncRunning(app.redis, storeId, null);
    const result = await getStatus();
    expect(result).toMatchObject({ state: 'running', total: null, imported: 0 });
  });

  it('caps imported progress at the known total', async () => {
    await markProductSyncRunning(app.redis, storeId, 50);
    const status = JSON.parse((await app.redis.get(`shopify:sync:status:${storeId}`)) ?? '{}');
    await Promise.all(
      Array.from({ length: 60 }, (_, index) =>
        insertGarment(100 + index, new Date(status.startedAt + 1000)),
      ),
    );
    const result = await getStatus();
    expect(result.imported).toBe(50);
  });
});
