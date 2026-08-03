import { schema } from '@aivastra/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { upsertShopifyStore } from '../src/modules/shopify/auth.routes.js';
import {
  searchCollections,
  syncCollectionMembership,
} from '../src/modules/shopify/collections.sync.js';
import { buildTestApp, type TestApp } from './helpers/api.js';
import { type Containers, startContainers } from './helpers/containers.js';

let c: Containers;
let app: TestApp;
let storeId: string;

beforeAll(async () => {
  c = await startContainers();
  app = await buildTestApp(c, {
    SHOPIFY_TOKEN_ENC_KEY: Buffer.alloc(32, 3).toString('base64'),
    SHOPIFY_API_SECRET: 'test-secret',
    SHOPIFY_API_KEY: 'test-key',
  });
  const store = await upsertShopifyStore(
    app,
    {
      shopifyShopId: 77,
      shopDomain: 'c.myshopify.com',
      myshopifyDomain: 'c.myshopify.com',
      name: 'C',
      email: 'c@c.com',
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

describe('syncCollectionMembership', () => {
  it("replaces a collection's membership with a fresh pull, and fetches its title", async () => {
    const [store] = await app.db
      .select()
      .from(schema.shopifyStores)
      .where(eq(schema.shopifyStores.id, storeId));

    await app.db.insert(schema.shopifyCollectionProducts).values({
      storeId,
      shopifyCollectionId: 500,
      shopifyProductId: 999, // stale — must be gone after resync
    });

    const originalFetch = global.fetch;
    global.fetch = (async (url: string) => {
      if (url.includes('/custom_collections/500.json')) {
        return {
          ok: true,
          json: async () => ({ custom_collection: { id: 500, title: 'Summer' } }),
        } as Response;
      }
      if (url.includes('/collects.json')) {
        return {
          ok: true,
          headers: new Map(),
          json: async () => ({
            collects: [
              { collection_id: 500, product_id: 1 },
              { collection_id: 500, product_id: 2 },
            ],
          }),
        } as unknown as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    try {
      const result = await syncCollectionMembership(app, store, 500);
      expect(result).toEqual({ title: 'Summer', productCount: 2 });

      const rows = await app.db
        .select()
        .from(schema.shopifyCollectionProducts)
        .where(
          and(
            eq(schema.shopifyCollectionProducts.storeId, storeId),
            eq(schema.shopifyCollectionProducts.shopifyCollectionId, 500),
          ),
        );
      expect(rows.map((r) => r.shopifyProductId).sort()).toEqual([1, 2]);
      expect(rows.some((r) => r.shopifyProductId === 999)).toBe(false);

      const [collectionRow] = await app.db
        .select()
        .from(schema.shopifyCollections)
        .where(
          and(
            eq(schema.shopifyCollections.storeId, storeId),
            eq(schema.shopifyCollections.shopifyCollectionId, 500),
          ),
        );
      expect(collectionRow.title).toBe('Summer');
    } finally {
      global.fetch = originalFetch;
    }
  });
});

describe('syncCollectionMembership — deleted collection', () => {
  it('throws CollectionNotFoundError when both resources 404', async () => {
    const [store] = await app.db
      .select()
      .from(schema.shopifyStores)
      .where(eq(schema.shopifyStores.id, storeId));

    const originalFetch = global.fetch;
    global.fetch = (async () =>
      ({ ok: false, status: 404, json: async () => ({}) }) as Response) as typeof fetch;

    try {
      const { CollectionNotFoundError } = await import(
        '../src/modules/shopify/collections.sync.js'
      );
      await expect(syncCollectionMembership(app, store, 12345)).rejects.toBeInstanceOf(
        CollectionNotFoundError,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('does not classify a rate-limit response as not-found', async () => {
    const [store] = await app.db
      .select()
      .from(schema.shopifyStores)
      .where(eq(schema.shopifyStores.id, storeId));

    const originalFetch = global.fetch;
    global.fetch = (async () =>
      ({ ok: false, status: 429, json: async () => ({}) }) as Response) as typeof fetch;

    try {
      const { CollectionNotFoundError } = await import(
        '../src/modules/shopify/collections.sync.js'
      );
      await expect(syncCollectionMembership(app, store, 12345)).rejects.not.toBeInstanceOf(
        CollectionNotFoundError,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });
});

describe('searchCollections', () => {
  it('filters the full custom+smart collection list by a case-insensitive title substring', async () => {
    const [store] = await app.db
      .select()
      .from(schema.shopifyStores)
      .where(eq(schema.shopifyStores.id, storeId));

    const originalFetch = global.fetch;
    global.fetch = (async (url: string) => {
      if (url.includes('/custom_collections.json')) {
        return {
          ok: true,
          headers: new Map(),
          json: async () => ({ custom_collections: [{ id: 1, title: 'Summer Dresses' }] }),
        } as unknown as Response;
      }
      if (url.includes('/smart_collections.json')) {
        return {
          ok: true,
          headers: new Map(),
          json: async () => ({ smart_collections: [{ id: 2, title: 'Winter Coats' }] }),
        } as unknown as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    try {
      const results = await searchCollections(app, store, 'summer');
      expect(results).toEqual([{ shopifyCollectionId: 1, title: 'Summer Dresses' }]);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
