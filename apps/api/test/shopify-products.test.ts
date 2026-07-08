import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { upsertShopifyStore } from '../src/modules/shopify/auth.routes.js';
import { buildTestApp, type TestApp } from './helpers/api.js';
import { type Containers, startContainers } from './helpers/containers.js';
import { signSessionToken } from './helpers/shopify-session.js';

const ENC_KEY = Buffer.alloc(32, 3).toString('base64');
const API_SECRET = 'test-secret';
const API_KEY = 'test-key';
let c: Containers;
let app: TestApp;
let storeId: string;
let token: string;

beforeAll(async () => {
  c = await startContainers();
  app = await buildTestApp(c, {
    SHOPIFY_TOKEN_ENC_KEY: ENC_KEY,
    SHOPIFY_API_SECRET: API_SECRET,
    SHOPIFY_API_KEY: API_KEY,
  });
  const store = await upsertShopifyStore(
    app,
    {
      shopifyShopId: 55,
      shopDomain: 'p.myshopify.com',
      myshopifyDomain: 'p.myshopify.com',
      name: 'P',
      email: 'p@p.com',
    },
    'tok',
    'read_products',
  );
  storeId = store.id;
  token = signSessionToken('p.myshopify.com', API_SECRET, API_KEY);

  await app.db.insert(schema.shopifyProductGarments).values([
    {
      storeId,
      shopifyProductId: 1,
      shopifyVariantId: null,
      r2Key: `shopify-garments/${storeId}/1/garment.jpg`,
      title: 'Red Shirt',
      status: 'active',
      enabled: true,
    },
    {
      storeId,
      shopifyProductId: 2,
      shopifyVariantId: null,
      r2Key: `shopify-garments/${storeId}/2/garment.jpg`,
      title: 'Blue Shirt',
      status: 'processing',
      enabled: false,
    },
  ]);
});
afterAll(async () => {
  await app?.close();
  await c?.stop();
});

describe('GET /v1/shopify/products', () => {
  it("lists this store's synced products with status and enabled state", async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/shopify/products',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(2);
    const red = body.items.find((p: { shopifyProductId: number }) => p.shopifyProductId === 1);
    expect(red.title).toBe('Red Shirt');
    expect(red.status).toBe('active');
    expect(red.enabled).toBe(true);
    expect(red.thumbnailUrl).toBe(
      app.storage.publicUrl(`shopify-garments/${storeId}/1/garment.jpg`),
    );
    const blue = body.items.find((p: { shopifyProductId: number }) => p.shopifyProductId === 2);
    expect(blue.enabled).toBe(false);
  });

  it('paginates with page/pageSize', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/shopify/products?page=1&pageSize=1',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(1);
    expect(body.total).toBe(2);
  });
});

describe('GET /v1/shopify/products/:id/images', () => {
  it('returns the live image list from Shopify for that product', async () => {
    const originalFetch = global.fetch;
    global.fetch = (async (url: string) => {
      expect(url).toContain('/products/1/images.json');
      return {
        ok: true,
        json: async () => ({
          images: [
            { id: 111, src: 'https://cdn.shopify.com/s/files/1/one.jpg' },
            { id: 222, src: 'https://cdn.shopify.com/s/files/1/two.jpg' },
          ],
        }),
      } as Response;
    }) as typeof fetch;

    try {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/shopify/products/1/images',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        images: [
          { id: 111, src: 'https://cdn.shopify.com/s/files/1/one.jpg' },
          { id: 222, src: 'https://cdn.shopify.com/s/files/1/two.jpg' },
        ],
      });
    } finally {
      global.fetch = originalFetch;
    }
  });
});

describe('PATCH /v1/shopify/products/:id', () => {
  it('rejects enabling a product that is not active', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/shopify/products/2',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { enabled: true },
    });
    expect(res.statusCode).toBe(400);
  });

  it('enables an active product', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/shopify/products/1',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { enabled: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().enabled).toBe(true);
  });

  it('disables a product regardless of status', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/shopify/products/2',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { enabled: false },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().enabled).toBe(false);
  });

  it("rejects a garmentImageUrl not in the product's real Shopify image list", async () => {
    const originalFetch = global.fetch;
    global.fetch = (async () =>
      ({
        ok: true,
        json: async () => ({
          images: [{ id: 1, src: 'https://cdn.shopify.com/s/files/1/real.jpg' }],
        }),
      }) as Response) as typeof fetch;

    try {
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/shopify/products/1',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        payload: { garmentImageUrl: 'https://cdn.shopify.com/s/files/1/fake.jpg' },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("swaps the garment image to a real one from the product's image list", async () => {
    const originalFetch = global.fetch;
    let downloadedFrom: string | undefined;
    global.fetch = (async (url: string) => {
      if (url.includes('/images.json')) {
        return {
          ok: true,
          json: async () => ({
            images: [{ id: 1, src: 'https://cdn.shopify.com/s/files/1/new.jpg' }],
          }),
        } as Response;
      }
      downloadedFrom = url;
      return {
        ok: true,
        redirected: false,
        arrayBuffer: async () => new ArrayBuffer(4),
        headers: { get: () => 'image/jpeg' },
      } as unknown as Response;
    }) as typeof fetch;

    try {
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/shopify/products/1',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        payload: { garmentImageUrl: 'https://cdn.shopify.com/s/files/1/new.jpg' },
      });
      expect(res.statusCode).toBe(200);
      expect(downloadedFrom).toBe('https://cdn.shopify.com/s/files/1/new.jpg');
      const [row] = await app.db
        .select()
        .from(schema.shopifyProductGarments)
        .where(eq(schema.shopifyProductGarments.shopifyProductId, 1));
      expect(row.r2Key).not.toBe(`shopify-garments/${storeId}/1/garment.jpg`);
      expect(row.r2Key).toContain(`shopify-garments/${storeId}/1/garment-`);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
