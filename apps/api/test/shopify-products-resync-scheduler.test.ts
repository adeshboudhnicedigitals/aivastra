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
