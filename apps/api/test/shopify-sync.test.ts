import { schema } from '@aivastra/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { upsertShopifyStore } from '../src/modules/shopify/auth.routes.js';
import { syncProduct } from '../src/modules/shopify/products.sync.js';
import { buildTestApp, type TestApp } from './helpers/api.js';
import { type Containers, startContainers } from './helpers/containers.js';

const ENC_KEY = Buffer.alloc(32, 5).toString('base64');
let c: Containers;
let app: TestApp;
let storeId: string;

beforeAll(async () => {
  c = await startContainers();
  app = await buildTestApp(c, { SHOPIFY_TOKEN_ENC_KEY: ENC_KEY });
  const store = await upsertShopifyStore(
    app,
    {
      shopifyShopId: 7,
      shopDomain: 's.myshopify.com',
      myshopifyDomain: 's.myshopify.com',
      name: 'S',
      email: 's@s.com',
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

describe('syncProduct', () => {
  it('uploads first image to R2 and upserts an active garment row', async () => {
    const fakeFetch = (async () =>
      ({
        ok: true,
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        headers: new Map([['content-type', 'image/jpeg']]),
      }) as unknown as Response) as typeof fetch;
    await syncProduct(
      app,
      storeId,
      { id: 42, image: { src: 'https://cdn.shopify.com/x.jpg' } },
      fakeFetch,
    );
    const [row] = await app.db
      .select()
      .from(schema.shopifyProductGarments)
      .where(
        and(
          eq(schema.shopifyProductGarments.storeId, storeId),
          eq(schema.shopifyProductGarments.shopifyProductId, 42),
        ),
      );
    expect(row.status).toBe('active');
    expect(row.r2Key).toBe(`shopify-garments/${storeId}/42/garment.jpg`);
    const head = await app.storage.headObject(row.r2Key);
    expect(head.contentLength).toBe(3);
  });

  it('marks failed when a product has no image', async () => {
    const fakeFetch = (async () => {
      throw new Error('should not be called');
    }) as typeof fetch;
    await syncProduct(app, storeId, { id: 43, image: null }, fakeFetch);
    const [row] = await app.db
      .select()
      .from(schema.shopifyProductGarments)
      .where(
        and(
          eq(schema.shopifyProductGarments.storeId, storeId),
          eq(schema.shopifyProductGarments.shopifyProductId, 43),
        ),
      );
    expect(row.status).toBe('failed');
    expect(row.failedReason).toBeTruthy();
  });
});
