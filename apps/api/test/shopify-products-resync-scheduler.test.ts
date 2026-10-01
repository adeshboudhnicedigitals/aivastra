import { schema } from '@aivastra/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { upsertShopifyStore } from '../src/modules/shopify/auth.routes.js';
import { syncOneTask } from '../src/modules/shopify/products.sync.js';
import { runResyncTick } from '../src/modules/shopify/products-resync-scheduler.js';
import { buildTestApp, type TestApp } from './helpers/api.js';
import { type Containers, startContainers } from './helpers/containers.js';

let c: Containers;
let app: TestApp;

beforeAll(async () => {
  c = await startContainers();
  app = await buildTestApp(c, {
    SHOPIFY_TOKEN_ENC_KEY: Buffer.alloc(32, 3).toString('base64'),
    SHOPIFY_API_SECRET: 'test-secret',
    SHOPIFY_API_KEY: 'test-key',
  });
});
afterAll(async () => {
  await app?.close();
  await c?.stop();
});

describe('runResyncTick', () => {
  it('enqueues one reconcile task per store with non-deleted products, and skips stores with none', async () => {
    const storeWithProducts = await upsertShopifyStore(
      app,
      {
        shopifyShopId: 910,
        shopDomain: 'r1.myshopify.com',
        myshopifyDomain: 'r1.myshopify.com',
        name: 'R1',
        email: 'r1@r1.com',
      },
      'tok',
      'read_products',
    );
    const storeAllDeleted = await upsertShopifyStore(
      app,
      {
        shopifyShopId: 911,
        shopDomain: 'r2.myshopify.com',
        myshopifyDomain: 'r2.myshopify.com',
        name: 'R2',
        email: 'r2@r2.com',
      },
      'tok',
      'read_products',
    );
    const storeNeverSynced = await upsertShopifyStore(
      app,
      {
        shopifyShopId: 912,
        shopDomain: 'r3.myshopify.com',
        myshopifyDomain: 'r3.myshopify.com',
        name: 'R3',
        email: 'r3@r3.com',
      },
      'tok',
      'read_products',
    );

    await app.db.insert(schema.shopifyProductGarments).values({
      storeId: storeWithProducts.id,
      shopifyProductId: 1,
      shopifyVariantId: 0,
      r2Key: 'x',
      title: 'Live',
      status: 'active',
    });
    await app.db.insert(schema.shopifyProductGarments).values({
      storeId: storeAllDeleted.id,
      shopifyProductId: 2,
      shopifyVariantId: 0,
      r2Key: 'y',
      title: 'Gone',
      status: 'deleted',
    });

    const xaddSpy = vi.spyOn(app.redis, 'xadd');
    await runResyncTick(app);

    const enqueuedTasks = xaddSpy.mock.calls
      .filter((call) => call[0] === 'shopify:sync')
      .map((call) => JSON.parse(call[3] as string));

    expect(
      enqueuedTasks.some((t) => t.storeId === storeWithProducts.id && t.mode === 'reconcile'),
    ).toBe(true);
    expect(enqueuedTasks.some((t) => t.storeId === storeAllDeleted.id)).toBe(false);
    expect(enqueuedTasks.some((t) => t.storeId === storeNeverSynced.id)).toBe(false);

    xaddSpy.mockRestore();
  });
});

describe('syncOneTask — reconcile mode', () => {
  it('marks a product Shopify no longer returns as deleted, leaves live ones alone, and pages the cursor', async () => {
    const store = await upsertShopifyStore(
      app,
      {
        shopifyShopId: 913,
        shopDomain: 'r4.myshopify.com',
        myshopifyDomain: 'r4.myshopify.com',
        name: 'R4',
        email: 'r4@r4.com',
      },
      'tok',
      'read_products',
    );

    await app.db.insert(schema.shopifyProductGarments).values([
      {
        storeId: store.id,
        shopifyProductId: 801,
        shopifyVariantId: 0,
        r2Key: 'a',
        status: 'active',
      },
      {
        storeId: store.id,
        shopifyProductId: 802,
        shopifyVariantId: 0,
        r2Key: 'b',
        status: 'active',
      },
      {
        storeId: store.id,
        shopifyProductId: 803,
        shopifyVariantId: 0,
        r2Key: 'c',
        status: 'failed',
      },
      // Already deleted — must stay untouched (no-op, not re-updated).
      {
        storeId: store.id,
        shopifyProductId: 804,
        shopifyVariantId: 0,
        r2Key: 'd',
        status: 'deleted',
      },
    ]);

    let callCount = 0;
    const originalFetch = global.fetch;
    global.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (!url.endsWith('/graphql.json')) throw new Error(`unexpected fetch: ${url}`);
      callCount++;
      const body = JSON.parse(String(init?.body)) as { variables?: { cursor?: string | null } };
      if (callCount === 1) {
        expect(body.variables?.cursor ?? null).toBeNull();
        // Only 801 still exists — 802 and 803 are gone from Shopify.
        return new Response(
          JSON.stringify({
            data: {
              products: {
                pageInfo: { hasNextPage: true, endCursor: 'q1' },
                nodes: [{ id: 'gid://shopify/Product/801' }],
              },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      expect(body.variables?.cursor).toBe('q1');
      return new Response(
        JSON.stringify({
          data: { products: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    try {
      await syncOneTask(app, { storeId: store.id, mode: 'reconcile' });
      expect(callCount).toBe(2);

      const rows = await app.db
        .select()
        .from(schema.shopifyProductGarments)
        .where(eq(schema.shopifyProductGarments.storeId, store.id));
      const byId = new Map(rows.map((r) => [r.shopifyProductId, r]));

      expect(byId.get(801)?.status).toBe('active'); // still live, untouched
      expect(byId.get(802)?.status).toBe('deleted'); // no longer returned
      expect(byId.get(803)?.status).toBe('deleted'); // no longer returned
      expect(byId.get(804)?.status).toBe('deleted'); // was already deleted
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('discovers and syncs a product Shopify has that this store has never seen (products/create backstop)', async () => {
    const store = await upsertShopifyStore(
      app,
      {
        shopifyShopId: 915,
        shopDomain: 'r6.myshopify.com',
        myshopifyDomain: 'r6.myshopify.com',
        name: 'R6',
        email: 'r6@r6.com',
      },
      'tok',
      'read_products',
    );

    await app.db.insert(schema.shopifyProductGarments).values({
      storeId: store.id,
      shopifyProductId: 850,
      shopifyVariantId: 0,
      r2Key: 'known',
      title: 'Already Known',
      status: 'active',
    });

    let oneProductCalls = 0;
    const originalFetch = global.fetch;
    global.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (!url.endsWith('/graphql.json')) throw new Error(`unexpected fetch: ${url}`);
      const body = JSON.parse(String(init?.body)) as { query: string };
      if (body.query.includes('ProductIdsPage')) {
        // Shopify has 850 (already known) and 851 (never synced before).
        return new Response(
          JSON.stringify({
            data: {
              products: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [{ id: 'gid://shopify/Product/850' }, { id: 'gid://shopify/Product/851' }],
              },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (body.query.includes('OneProduct')) {
        oneProductCalls++;
        return new Response(
          JSON.stringify({
            data: {
              product: {
                id: 'gid://shopify/Product/851',
                title: 'Brand New Product',
                productType: null,
                tags: [],
                vendor: null,
                featuredImage: null,
                collections: { nodes: [] },
              },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      throw new Error(`unexpected graphql query: ${body.query}`);
    }) as typeof fetch;

    try {
      await syncOneTask(app, { storeId: store.id, mode: 'reconcile' });

      // Only the genuinely-new id (851) triggers a OneProduct lookup — 850 was
      // already known and must not be re-fetched by the reconcile backstop.
      expect(oneProductCalls).toBe(1);

      const rows = await app.db
        .select()
        .from(schema.shopifyProductGarments)
        .where(eq(schema.shopifyProductGarments.storeId, store.id));
      const byId = new Map(rows.map((r) => [r.shopifyProductId, r]));

      expect(byId.get(850)?.status).toBe('active');
      expect(byId.get(850)?.title).toBe('Already Known'); // untouched
      expect(byId.get(851)?.title).toBe('Brand New Product');
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('gives failed products a second chance: retries a live one, leaves a gone one deleted, and skips ids it just fetched', async () => {
    const store = await upsertShopifyStore(
      app,
      {
        shopifyShopId: 916,
        shopDomain: 'r7.myshopify.com',
        myshopifyDomain: 'r7.myshopify.com',
        name: 'R7',
        email: 'r7@r7.com',
      },
      'tok',
      'read_products',
    );
    await app.db.insert(schema.shopifyProductGarments).values([
      // Failed at create time (its image had not attached yet); Shopify has one now.
      {
        storeId: store.id,
        shopifyProductId: 860,
        shopifyVariantId: 0,
        r2Key: 'a',
        title: 'Late Image',
        status: 'failed',
        failedReason: 'no product image',
      },
      // Failed, and no longer on Shopify: the deletion pass must win over the retry.
      {
        storeId: store.id,
        shopifyProductId: 861,
        shopifyVariantId: 0,
        r2Key: 'b',
        title: 'Gone',
        status: 'failed',
        failedReason: 'no product image',
      },
    ]);

    const fetched: string[] = [];
    const originalFetch = global.fetch;
    global.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('https://cdn.shopify.com/')) {
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'content-type': 'image/jpeg' },
        });
      }
      if (!url.endsWith('/graphql.json')) throw new Error(`unexpected fetch: ${url}`);
      const body = JSON.parse(String(init?.body)) as {
        query: string;
        variables?: { id?: string };
      };
      if (body.query.includes('ProductIdsPage')) {
        // 860 still exists, 861 does not, 862 was never seen before.
        return new Response(
          JSON.stringify({
            data: {
              products: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [{ id: 'gid://shopify/Product/860' }, { id: 'gid://shopify/Product/862' }],
              },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (body.query.includes('OneProduct')) {
        const id = String(body.variables?.id);
        fetched.push(id.split('/').pop() as string);
        return new Response(
          JSON.stringify({
            data: {
              product: {
                id,
                title: id.endsWith('/860') ? 'Late Image' : 'Brand New Product',
                productType: null,
                tags: [],
                vendor: null,
                // 860 has its image now; the new product 862 still has none, so it
                // ends this pass failed — and must not be retried in the same pass.
                featuredImage: id.endsWith('/860')
                  ? { url: 'https://cdn.shopify.com/a.jpg' }
                  : null,
                collections: { nodes: [] },
              },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      throw new Error(`unexpected graphql query: ${body.query}`);
    }) as typeof fetch;

    try {
      await syncOneTask(app, { storeId: store.id, mode: 'reconcile' });

      const rows = await app.db
        .select()
        .from(schema.shopifyProductGarments)
        .where(eq(schema.shopifyProductGarments.storeId, store.id));
      const byId = new Map(rows.map((r) => [r.shopifyProductId, r]));

      expect(byId.get(860)?.status).toBe('active');
      expect(byId.get(860)?.failedReason).toBeNull();
      expect(byId.get(861)?.status).toBe('deleted');
      expect(byId.get(862)?.status).toBe('failed');
      // One lookup each for the new product (862) and the retried one (860); the
      // gone product is never fetched, and 862 is not fetched a second time.
      expect(fetched.sort()).toEqual(['860', '862']);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('marks every non-deleted row deleted when Shopify returns zero products', async () => {
    const store = await upsertShopifyStore(
      app,
      {
        shopifyShopId: 914,
        shopDomain: 'r5.myshopify.com',
        myshopifyDomain: 'r5.myshopify.com',
        name: 'R5',
        email: 'r5@r5.com',
      },
      'tok',
      'read_products',
    );
    await app.db.insert(schema.shopifyProductGarments).values({
      storeId: store.id,
      shopifyProductId: 900,
      shopifyVariantId: 0,
      r2Key: 'z',
      status: 'active',
    });

    const originalFetch = global.fetch;
    global.fetch = (async () =>
      new Response(
        JSON.stringify({
          data: { products: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )) as typeof fetch;

    try {
      await syncOneTask(app, { storeId: store.id, mode: 'reconcile' });
      const [row] = await app.db
        .select()
        .from(schema.shopifyProductGarments)
        .where(
          and(
            eq(schema.shopifyProductGarments.storeId, store.id),
            eq(schema.shopifyProductGarments.shopifyProductId, 900),
          ),
        );
      expect(row.status).toBe('deleted');
    } finally {
      global.fetch = originalFetch;
    }
  });
});
