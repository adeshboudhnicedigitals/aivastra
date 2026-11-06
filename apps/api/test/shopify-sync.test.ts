import { schema } from '@aivastra/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { upsertShopifyStore } from '../src/modules/shopify/auth.routes.js';
import {
  ensureGarmentImage,
  syncOneTask,
  syncProduct,
  syncProductNow,
} from '../src/modules/shopify/products.sync.js';
import { isProductSyncActive } from '../src/modules/shopify/service.js';
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

const mockFetch = (async () =>
  ({
    ok: true,
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    headers: new Map([['content-type', 'image/jpeg']]),
  }) as unknown as Response) as typeof fetch;

describe('syncProduct', () => {
  const rowFor = async (productId: number) => {
    const [row] = await app.db
      .select()
      .from(schema.shopifyProductGarments)
      .where(
        and(
          eq(schema.shopifyProductGarments.storeId, storeId),
          eq(schema.shopifyProductGarments.shopifyProductId, productId),
        ),
      );
    return row;
  };

  it('upserts an active garment row and records the image URL without downloading it', async () => {
    await syncProduct(app, storeId, {
      id: 42,
      title: 'Test Product',
      imageUrl: 'https://cdn.shopify.com/x.jpg',
    });
    const row = await rowFor(42);
    expect(row.status).toBe('active');
    expect(row.title).toBe('Test Product');
    expect(row.imageUrl).toBe('https://cdn.shopify.com/x.jpg');
    expect(row.r2Key).toBe(`shopify-garments/${storeId}/42/garment.jpg`);
    await expect(app.storage.headObject(row.r2Key)).rejects.toBeTruthy();
  });

  it('marks failed when a product has no image', async () => {
    await syncProduct(app, storeId, { id: 43, title: 'No Image Product', imageUrl: null });
    const row = await rowFor(43);
    expect(row.status).toBe('failed');
    expect(row.failedReason).toBeTruthy();
  });

  it('marks failed when the image host is not Shopify', async () => {
    await syncProduct(app, storeId, {
      id: 45,
      title: 'Off Host',
      imageUrl: 'https://evil.example.com/x.jpg',
    });
    const row = await rowFor(45);
    expect(row.status).toBe('failed');
    expect(row.failedReason).toContain('image host not allowed');
  });

  it('drops the stored copy when the product image URL changes, and keeps it when it does not', async () => {
    const product = { id: 49, title: 'Reshot', imageUrl: 'https://cdn.shopify.com/a.jpg?v=1' };
    await syncProduct(app, storeId, product);
    const { r2Key } = await rowFor(49);
    await app.storage.putObject(r2Key, Buffer.from([1, 2, 3]), 'image/jpeg');

    await syncProduct(app, storeId, product);
    expect((await app.storage.headObject(r2Key)).contentLength).toBe(3);

    await syncProduct(app, storeId, { ...product, imageUrl: 'https://cdn.shopify.com/a.jpg?v=2' });
    await expect(app.storage.headObject(r2Key)).rejects.toBeTruthy();
    expect((await rowFor(49)).imageUrl).toBe('https://cdn.shopify.com/a.jpg?v=2');
  });

  it('leaves a merchant-picked override image alone when the product image changes', async () => {
    const product = { id: 50, title: 'Pinned', imageUrl: 'https://cdn.shopify.com/p.jpg?v=1' };
    await syncProduct(app, storeId, product);
    const overrideKey = `shopify-garments/${storeId}/50/garment-override.jpg`;
    await app.storage.putObject(overrideKey, Buffer.from([9]), 'image/jpeg');
    await app.db
      .update(schema.shopifyProductGarments)
      .set({ r2Key: overrideKey })
      .where(eq(schema.shopifyProductGarments.shopifyProductId, 50));

    await syncProduct(app, storeId, { ...product, imageUrl: 'https://cdn.shopify.com/p.jpg?v=2' });
    expect((await app.storage.headObject(overrideKey)).contentLength).toBe(1);
    expect((await rowFor(50)).r2Key).toBe(overrideKey);
  });
});

describe('ensureGarmentImage', () => {
  const okResponse = () =>
    ({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      headers: new Map([['content-type', 'image/jpeg']]),
    }) as unknown as Response;
  let n = 0;
  const garment = (imageUrl: string | null = 'https://cdn.shopify.com/x.jpg') => ({
    r2Key: `shopify-garments/${storeId}/ensure-${++n}/garment.jpg`,
    imageUrl,
  });

  it('downloads the image into storage on first use and skips the CDN once it is there', async () => {
    const g = garment();
    let calls = 0;
    const fetchFn = (async () => {
      calls++;
      return okResponse();
    }) as typeof fetch;
    await ensureGarmentImage(app, g, fetchFn);
    expect((await app.storage.headObject(g.r2Key)).contentLength).toBe(3);
    await ensureGarmentImage(app, g, fetchFn);
    expect(calls).toBe(1);
  });

  it('requests redirect: "error" and a live AbortSignal, so a CDN redirect off the allowlist is never followed', async () => {
    let capturedInit: RequestInit | undefined;
    const fetchFn = (async (_url: string, init?: RequestInit) => {
      capturedInit = init;
      return okResponse();
    }) as unknown as typeof fetch;
    await ensureGarmentImage(app, garment(), fetchFn);
    expect(capturedInit?.redirect).toBe('error');
    expect(capturedInit?.signal).toBeInstanceOf(AbortSignal);

    const redirecting = (async () => {
      throw new TypeError('unexpected redirect');
    }) as unknown as typeof fetch;
    await expect(ensureGarmentImage(app, garment(), redirecting)).rejects.toThrow('redirect');
  });

  it('throws without a URL or for a non-Shopify host, before any download', async () => {
    const never = (async () => {
      throw new Error('should not be called');
    }) as typeof fetch;
    await expect(ensureGarmentImage(app, garment(null), never)).rejects.toThrow('no product image');
    await expect(
      ensureGarmentImage(app, garment('https://evil.example.com/x.jpg'), never),
    ).rejects.toThrow('image host not allowed');
  });

  it('rejects an image over the 20MB cap from the header, without reading the body', async () => {
    let arrayBufferCalled = false;
    const fetchFn = (async () =>
      ({
        ok: true,
        arrayBuffer: async () => {
          arrayBufferCalled = true;
          return new Uint8Array([1]).buffer;
        },
        headers: new Map([
          ['content-type', 'image/jpeg'],
          ['content-length', String(21 * 1024 * 1024)],
        ]),
      }) as unknown as Response) as typeof fetch;
    await expect(ensureGarmentImage(app, garment(), fetchFn)).rejects.toThrow('20MB');
    expect(arrayBufferCalled).toBe(false);
  });

  it('rejects an image whose body exceeds the cap when there is no content-length', async () => {
    const oversized = new Uint8Array(21 * 1024 * 1024);
    const fetchFn = (async () =>
      ({
        ok: true,
        arrayBuffer: async () => oversized.buffer,
        headers: new Map([['content-type', 'image/jpeg']]),
      }) as unknown as Response) as typeof fetch;
    await expect(ensureGarmentImage(app, garment(), fetchFn)).rejects.toThrow('20MB');
  });

  it('respects an admin-configured limit lower than the default 20MB cap', async () => {
    await app.redis.set(
      'config:system',
      JSON.stringify({ uploadLimits: { shopifyProductSyncMaxBytes: 5 } }),
    );
    try {
      const fetchFn = (async () =>
        ({
          ok: true,
          arrayBuffer: async () => new Uint8Array([1, 2, 3, 4, 5, 6]).buffer,
          headers: new Map([['content-type', 'image/jpeg']]),
        }) as unknown as Response) as typeof fetch;
      await expect(ensureGarmentImage(app, garment(), fetchFn)).rejects.toThrow('MB');
    } finally {
      await app.redis.del('config:system');
    }
  });

  it('retries once after a dropped connection', async () => {
    let calls = 0;
    const flaky = (async () => {
      calls++;
      if (calls === 1) throw new TypeError('fetch failed');
      return okResponse();
    }) as typeof fetch;
    await ensureGarmentImage(app, garment(), flaky);
    expect(calls).toBe(2);
  });

  it('retries once after a CDN 503', async () => {
    let calls = 0;
    const flaky = (async () => {
      calls++;
      return calls === 1 ? ({ ok: false, status: 503 } as unknown as Response) : okResponse();
    }) as typeof fetch;
    await ensureGarmentImage(app, garment(), flaky);
    expect(calls).toBe(2);
  });

  it('aborts and retries a body that stalls after the headers arrived', async () => {
    // Fake only the timers: the DB and MinIO calls are real socket I/O.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      let calls = 0;
      const stallsOnce = (async (_url: string, init?: RequestInit) => {
        calls++;
        if (calls > 1) {
          // Fake timers must not outlive the download: the MinIO client's own
          // request timers would fire under them and fail the put.
          vi.useRealTimers();
          return okResponse();
        }
        return {
          ok: true,
          headers: new Map([['content-type', 'image/jpeg']]),
          arrayBuffer: () =>
            new Promise<ArrayBuffer>((_resolve, reject) => {
              init?.signal?.addEventListener('abort', () => reject(new TypeError('aborted')));
            }),
        } as unknown as Response;
      }) as unknown as typeof fetch;
      const done = ensureGarmentImage(app, garment(), stallsOnce);
      const tick = () => new Promise((r) => setImmediate(r));
      while (calls < 1) await tick();
      await vi.advanceTimersByTimeAsync(30_001);
      while (calls < 2) {
        await vi.advanceTimersByTimeAsync(500);
        await tick();
      }
      await done;
      expect(calls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not retry a 404, and fails with the status', async () => {
    let calls = 0;
    const gone = (async () => {
      calls++;
      return { ok: false, status: 404 } as unknown as Response;
    }) as typeof fetch;
    await expect(ensureGarmentImage(app, garment(), gone)).rejects.toThrow('download HTTP 404');
    expect(calls).toBe(1);
  });

  it('gives up after the second failure', async () => {
    let calls = 0;
    const down = (async () => {
      calls++;
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ETIMEDOUT' } });
    }) as typeof fetch;
    await expect(ensureGarmentImage(app, garment(), down)).rejects.toThrow('fetch failed');
    expect(calls).toBe(2);
  });
});

describe('syncProduct metadata', () => {
  it('persists product_type/tags/vendor', async () => {
    await syncProduct(
      app,
      storeId,
      {
        id: 501,
        title: 'Test Shirt',
        imageUrl: 'https://cdn.shopify.com/shirt.jpg',
        productType: 'Shirts',
        tags: ['Sale', 'Cotton'],
        vendor: 'Acme Co',
      },
      mockFetch,
    );

    const [row] = await app.db
      .select()
      .from(schema.shopifyProductGarments)
      .where(
        and(
          eq(schema.shopifyProductGarments.storeId, storeId),
          eq(schema.shopifyProductGarments.shopifyProductId, 501),
        ),
      );
    expect(row.productType).toBe('Shirts');
    expect(row.tags).toEqual(['Sale', 'Cotton']);
    expect(row.vendor).toBe('Acme Co');
  });

  it('persists collections when a product belongs to multiple collections', async () => {
    await syncProduct(
      app,
      storeId,
      {
        id: 504,
        title: 'Summer Shirt',
        imageUrl: 'https://cdn.shopify.com/shirt4.jpg',
        collections: ['Summer Sale', 'New Arrivals'],
      },
      mockFetch,
    );

    const [row] = await app.db
      .select()
      .from(schema.shopifyProductGarments)
      .where(
        and(
          eq(schema.shopifyProductGarments.storeId, storeId),
          eq(schema.shopifyProductGarments.shopifyProductId, 504),
        ),
      );
    expect(row.collections).toEqual(['Summer Sale', 'New Arrivals']);
  });

  it('stores the product category, and clears it when Shopify stops reporting one', async () => {
    await syncProduct(
      app,
      storeId,
      {
        id: 90,
        title: 'Categorised',
        imageUrl: 'https://cdn.shopify.com/x.jpg',
        category: 'Apparel & Accessories > Clothing > Dresses',
      },
      mockFetch,
    );
    const read = async () => {
      const [row] = await app.db
        .select()
        .from(schema.shopifyProductGarments)
        .where(
          and(
            eq(schema.shopifyProductGarments.storeId, storeId),
            eq(schema.shopifyProductGarments.shopifyProductId, 90),
          ),
        );
      return row;
    };
    expect((await read()).category).toBe('Apparel & Accessories > Clothing > Dresses');

    await syncProduct(
      app,
      storeId,
      { id: 90, title: 'Categorised', imageUrl: 'https://cdn.shopify.com/x.jpg' },
      mockFetch,
    );
    expect((await read()).category).toBeNull();
  });
});

describe('syncOneTask — full sync pagination', () => {
  it('threads the cursor across pages, syncs products from both, and reconciles against a fresh final id-only pass', async () => {
    // Isolated store: a full sync now reconciles deletions against every row
    // it finds for the store, and this test's mocked catalog (601, 602 only)
    // would otherwise wrongly mark other tests' unrelated products in the
    // shared `storeId` as deleted.
    const store = await upsertShopifyStore(
      app,
      {
        shopifyShopId: 704,
        shopDomain: 'full-sync.myshopify.com',
        myshopifyDomain: 'full-sync.myshopify.com',
        name: 'Full Sync Store',
        email: 'full-sync@s.com',
      },
      'tok',
      'read_products',
    );

    // Pre-existing row for a product Shopify no longer returns in this sync —
    // simulates a deletion whose products/delete webhook never arrived.
    await app.db.insert(schema.shopifyProductGarments).values({
      storeId: store.id,
      shopifyProductId: 699,
      shopifyVariantId: 0,
      r2Key: 'stale',
      title: 'Gone Product',
      status: 'active',
    });

    let detailedCallCount = 0;
    let idsCallCount = 0;
    const originalFetch = global.fetch;
    global.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (!url.endsWith('/graphql.json')) {
        throw new Error(`unexpected fetch during full sync: ${url}`);
      }
      const body = JSON.parse(String(init?.body)) as {
        query: string;
        variables?: { cursor?: string | null };
      };

      // The fresh final reconciliation pass — same query 'reconcile' mode
      // uses. Returns both live ids in one page (page size 250, well above
      // this test's 2 products), so no self-heal is triggered here (that's
      // covered by the next test).
      if (body.query.includes('ProductIdsPage')) {
        idsCallCount++;
        expect(body.variables?.cursor ?? null).toBeNull();
        return new Response(
          JSON.stringify({
            data: {
              products: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [{ id: 'gid://shopify/Product/601' }, { id: 'gid://shopify/Product/602' }],
              },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      // The main detailed pass (nested collections field, 25/page).
      detailedCallCount++;
      if (detailedCallCount === 1) {
        expect(body.variables?.cursor ?? null).toBeNull();
        return new Response(
          JSON.stringify({
            data: {
              products: {
                pageInfo: { hasNextPage: true, endCursor: 'p1' },
                nodes: [
                  {
                    id: 'gid://shopify/Product/601',
                    title: 'Page One Product',
                    productType: null,
                    tags: [],
                    vendor: null,
                    featuredImage: null,
                    collections: { nodes: [] },
                  },
                ],
              },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      expect(body.variables?.cursor).toBe('p1');
      return new Response(
        JSON.stringify({
          data: {
            products: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [
                {
                  id: 'gid://shopify/Product/602',
                  title: 'Page Two Product',
                  productType: null,
                  tags: [],
                  vendor: null,
                  featuredImage: null,
                  collections: { nodes: [] },
                },
              ],
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    try {
      await syncOneTask(app, { storeId: store.id, mode: 'full' });
      expect(detailedCallCount).toBe(2);
      expect(idsCallCount).toBe(1);

      const rows = await app.db
        .select()
        .from(schema.shopifyProductGarments)
        .where(
          and(
            eq(schema.shopifyProductGarments.storeId, store.id),
            eq(schema.shopifyProductGarments.shopifyProductId, 601),
          ),
        );
      const [row2] = await app.db
        .select()
        .from(schema.shopifyProductGarments)
        .where(
          and(
            eq(schema.shopifyProductGarments.storeId, store.id),
            eq(schema.shopifyProductGarments.shopifyProductId, 602),
          ),
        );
      expect(rows[0]?.title).toBe('Page One Product');
      expect(row2?.title).toBe('Page Two Product');

      const [staleRow] = await app.db
        .select()
        .from(schema.shopifyProductGarments)
        .where(
          and(
            eq(schema.shopifyProductGarments.storeId, store.id),
            eq(schema.shopifyProductGarments.shopifyProductId, 699),
          ),
        );
      expect(staleRow.status).toBe('deleted');
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('self-heals a product present in the fresh final pass but missed by the detailed pass (created mid-sync)', async () => {
    const store = await upsertShopifyStore(
      app,
      {
        shopifyShopId: 705,
        shopDomain: 'self-heal.myshopify.com',
        myshopifyDomain: 'self-heal.myshopify.com',
        name: 'Self Heal Store',
        email: 'self-heal@s.com',
      },
      'tok',
      'read_products',
    );

    const originalFetch = global.fetch;
    global.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (!url.endsWith('/graphql.json')) {
        throw new Error(`unexpected fetch during full sync: ${url}`);
      }
      const body = JSON.parse(String(init?.body)) as { query: string };

      // Fresh final pass sees a product (805) the detailed pass below never
      // returned — simulates it being created on Shopify while the detailed
      // pass was already running.
      if (body.query.includes('ProductIdsPage')) {
        return new Response(
          JSON.stringify({
            data: {
              products: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [{ id: 'gid://shopify/Product/801' }, { id: 'gid://shopify/Product/805' }],
              },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      // Self-heal fetches the missed product individually.
      if (body.query.includes('OneProduct')) {
        return new Response(
          JSON.stringify({
            data: {
              product: {
                id: 'gid://shopify/Product/805',
                title: 'Mid-Sync Product',
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

      // Detailed pass only ever saw 801.
      return new Response(
        JSON.stringify({
          data: {
            products: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [
                {
                  id: 'gid://shopify/Product/801',
                  title: 'Existing Product',
                  productType: null,
                  tags: [],
                  vendor: null,
                  featuredImage: null,
                  collections: { nodes: [] },
                },
              ],
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    try {
      await syncOneTask(app, { storeId: store.id, mode: 'full' });

      const [row801] = await app.db
        .select()
        .from(schema.shopifyProductGarments)
        .where(
          and(
            eq(schema.shopifyProductGarments.storeId, store.id),
            eq(schema.shopifyProductGarments.shopifyProductId, 801),
          ),
        );
      const [row805] = await app.db
        .select()
        .from(schema.shopifyProductGarments)
        .where(
          and(
            eq(schema.shopifyProductGarments.storeId, store.id),
            eq(schema.shopifyProductGarments.shopifyProductId, 805),
          ),
        );
      expect(row801?.title).toBe('Existing Product');
      // No featuredImage in the mocked OneProduct response, so the self-heal
      // sync records it as 'failed' (no image to download) rather than
      // 'active' — the point of this test is that the row exists at all
      // (self-healed within this sync run) rather than being silently
      // missing until the next hourly reconcile tick.
      expect(row805?.title).toBe('Mid-Sync Product');
      expect(row805?.status).toBe('failed');
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('skips deletion reconciliation when the fresh final pass returns zero ids after the detailed pass saw products', async () => {
    const store = await upsertShopifyStore(
      app,
      {
        shopifyShopId: 706,
        shopDomain: 'empty-fresh-pass.myshopify.com',
        myshopifyDomain: 'empty-fresh-pass.myshopify.com',
        name: 'Empty Fresh Pass Store',
        email: 'empty-fresh-pass@s.com',
      },
      'tok',
      'read_products',
    );

    // Pre-existing row for a product neither pass returns. If the guard fails
    // and reconciliation runs against an empty freshLiveProductIds list, this
    // row would be wrongly flipped to 'deleted' along with the rest of the
    // store's catalog.
    await app.db.insert(schema.shopifyProductGarments).values({
      storeId: store.id,
      shopifyProductId: 902,
      shopifyVariantId: 0,
      r2Key: 'untouched',
      title: 'Untouched Product',
      status: 'active',
    });

    const originalFetch = global.fetch;
    global.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (!url.endsWith('/graphql.json')) {
        throw new Error(`unexpected fetch during full sync: ${url}`);
      }
      const body = JSON.parse(String(init?.body)) as { query: string };

      // Fresh final pass returns zero ids — simulates a transient anomaly on
      // this second, separate network round-trip.
      if (body.query.includes('ProductIdsPage')) {
        return new Response(
          JSON.stringify({
            data: {
              products: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [],
              },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      // Detailed pass genuinely saw a product.
      return new Response(
        JSON.stringify({
          data: {
            products: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [
                {
                  id: 'gid://shopify/Product/901',
                  title: 'Detailed Pass Product',
                  productType: null,
                  tags: [],
                  vendor: null,
                  featuredImage: null,
                  collections: { nodes: [] },
                },
              ],
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    try {
      await syncOneTask(app, { storeId: store.id, mode: 'full' });

      const [untouchedRow] = await app.db
        .select()
        .from(schema.shopifyProductGarments)
        .where(
          and(
            eq(schema.shopifyProductGarments.storeId, store.id),
            eq(schema.shopifyProductGarments.shopifyProductId, 902),
          ),
        );
      // Still 'active' — proves reconciliation was skipped rather than
      // treating the empty fresh pass as "delete everything for this store".
      expect(untouchedRow?.status).toBe('active');
    } finally {
      global.fetch = originalFetch;
    }
  });
});

describe('syncOneTask — product mode', () => {
  it('throws SHOPIFY_REAUTH_REQUIRED rather than blanking the garment row, on a 401 from Shopify', async () => {
    const originalFetch = global.fetch;
    global.fetch = (async () => new Response('unauthorized', { status: 401 })) as typeof fetch;

    try {
      await expect(
        syncOneTask(app, { storeId, mode: 'product', shopifyProductId: 701 }),
      ).rejects.toMatchObject({ code: 'SHOPIFY_REAUTH_REQUIRED' });

      const rows = await app.db
        .select()
        .from(schema.shopifyProductGarments)
        .where(
          and(
            eq(schema.shopifyProductGarments.storeId, storeId),
            eq(schema.shopifyProductGarments.shopifyProductId, 701),
          ),
        );
      // No garment row written: a store-wide auth failure must not blank a
      // per-product row.
      expect(rows).toHaveLength(0);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('still records a failure row for a generic (non-auth) fetch failure', async () => {
    const originalFetch = global.fetch;
    global.fetch = (async () => new Response('boom', { status: 502 })) as typeof fetch;

    try {
      await syncOneTask(app, { storeId, mode: 'product', shopifyProductId: 702 });

      const [row] = await app.db
        .select()
        .from(schema.shopifyProductGarments)
        .where(
          and(
            eq(schema.shopifyProductGarments.storeId, storeId),
            eq(schema.shopifyProductGarments.shopifyProductId, 702),
          ),
        );
      expect(row.status).toBe('failed');
      expect(row.failedReason).toContain('product fetch failed');
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('marks the product deleted (not failed) when Shopify reports it does not exist', async () => {
    const originalFetch = global.fetch;
    global.fetch = (async () =>
      new Response(JSON.stringify({ data: { product: null } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;

    try {
      await syncOneTask(app, { storeId, mode: 'product', shopifyProductId: 703 });

      const [row] = await app.db
        .select()
        .from(schema.shopifyProductGarments)
        .where(
          and(
            eq(schema.shopifyProductGarments.storeId, storeId),
            eq(schema.shopifyProductGarments.shopifyProductId, 703),
          ),
        );
      // "Not found" is the same confirmation the products/delete webhook acts
      // on — this must land in the same terminal state, not under a
      // failed-to-sync count that would never clear.
      expect(row.status).toBe('deleted');
      expect(row.failedReason).toBe('product not found on Shopify');
    } finally {
      global.fetch = originalFetch;
    }
  });
});

describe('syncOneTask — collection mode, refreshProducts', () => {
  it('resyncs every current member so its collections field reflects the change, not just the membership cache', async () => {
    const originalFetch = global.fetch;
    global.fetch = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { query: string; variables?: { id?: string } };
      if (body.query.includes('CollectionMembers')) {
        return new Response(
          JSON.stringify({
            data: {
              collection: {
                title: 'Sarees',
                products: {
                  pageInfo: { hasNextPage: false, endCursor: null },
                  nodes: [{ id: 'gid://shopify/Product/801' }, { id: 'gid://shopify/Product/802' }],
                },
              },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      // OneProduct — id encodes which of the two members this call is for.
      const productId = body.variables?.id?.endsWith('801') ? 801 : 802;
      return new Response(
        JSON.stringify({
          data: {
            product: {
              id: `gid://shopify/Product/${productId}`,
              title: `Product ${productId}`,
              productType: null,
              tags: null,
              vendor: null,
              featuredImage: null,
              collections: { nodes: [{ title: 'Sarees' }] },
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    try {
      await syncOneTask(app, {
        storeId,
        mode: 'collection',
        shopifyCollectionId: 950,
        refreshProducts: true,
      });

      const memberRows = await app.db
        .select()
        .from(schema.shopifyCollectionProducts)
        .where(
          and(
            eq(schema.shopifyCollectionProducts.storeId, storeId),
            eq(schema.shopifyCollectionProducts.shopifyCollectionId, 950),
          ),
        );
      expect(memberRows).toHaveLength(2);

      for (const productId of [801, 802]) {
        const [row] = await app.db
          .select()
          .from(schema.shopifyProductGarments)
          .where(
            and(
              eq(schema.shopifyProductGarments.storeId, storeId),
              eq(schema.shopifyProductGarments.shopifyProductId, productId),
            ),
          );
        expect(row.title).toBe(`Product ${productId}`);
        expect(row.collections).toEqual(['Sarees']);
      }
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('also refreshes a product that just left the collection, and skips one that stayed', async () => {
    const originalFetch = global.fetch;
    const oneProductCalls: number[] = [];

    function collectionMembersResponse(nodeIds: number[]) {
      return new Response(
        JSON.stringify({
          data: {
            collection: {
              title: 'Winter',
              products: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: nodeIds.map((id) => ({ id: `gid://shopify/Product/${id}` })),
              },
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    function oneProductResponse(productId: number, collections: string[]) {
      return new Response(
        JSON.stringify({
          data: {
            product: {
              id: `gid://shopify/Product/${productId}`,
              title: `Product ${productId}`,
              productType: null,
              tags: null,
              vendor: null,
              featuredImage: null,
              collections: { nodes: collections.map((title) => ({ title })) },
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    try {
      // Establish previous membership: 811 and 812 both in the collection.
      global.fetch = (async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { query: string };
        if (body.query.includes('CollectionMembers')) return collectionMembersResponse([811, 812]);
        throw new Error('unexpected OneProduct call during setup');
      }) as typeof fetch;
      await syncOneTask(app, { storeId, mode: 'collection', shopifyCollectionId: 960 });

      // Now the live collection only has 812 and 813: 811 left, 813 joined, 812
      // is unchanged. Refresh products for this second sync.
      global.fetch = (async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as {
          query: string;
          variables?: { id?: string };
        };
        if (body.query.includes('CollectionMembers')) return collectionMembersResponse([812, 813]);
        const productId = Number(body.variables?.id?.split('/').pop());
        oneProductCalls.push(productId);
        if (productId === 811) return oneProductResponse(811, []); // left the collection
        if (productId === 813) return oneProductResponse(813, ['Winter']); // just joined
        throw new Error(`unexpected OneProduct call for product ${productId}`);
      }) as typeof fetch;
      await syncOneTask(app, {
        storeId,
        mode: 'collection',
        shopifyCollectionId: 960,
        refreshProducts: true,
      });

      expect(oneProductCalls.sort()).toEqual([811, 813]); // 812 (unchanged) never fetched

      const [removed] = await app.db
        .select()
        .from(schema.shopifyProductGarments)
        .where(
          and(
            eq(schema.shopifyProductGarments.storeId, storeId),
            eq(schema.shopifyProductGarments.shopifyProductId, 811),
          ),
        );
      expect(removed.collections).toEqual([]);

      const [joined] = await app.db
        .select()
        .from(schema.shopifyProductGarments)
        .where(
          and(
            eq(schema.shopifyProductGarments.storeId, storeId),
            eq(schema.shopifyProductGarments.shopifyProductId, 813),
          ),
        );
      expect(joined.collections).toEqual(['Winter']);
    } finally {
      global.fetch = originalFetch;
    }
  });
});

describe('syncOneTask — full sync image handling', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('syncs every product of a page without requesting any image', async () => {
    const store = await upsertShopifyStore(
      app,
      {
        shopifyShopId: 9705,
        shopDomain: 'concurrency.myshopify.com',
        myshopifyDomain: 'concurrency.myshopify.com',
        name: 'Concurrency Store',
        email: 'concurrency@s.com',
      },
      'tok',
      'read_products',
    );
    const ids = Array.from({ length: 12 }, (_, i) => 7000 + i);
    let imageRequests = 0;
    const originalFetch = global.fetch;
    global.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/graphql.json')) {
        const body = JSON.parse(String(init?.body)) as { query: string };
        const nodes = ids.map((id) => ({
          id: `gid://shopify/Product/${id}`,
          title: `P${id}`,
          productType: null,
          tags: [],
          vendor: null,
          featuredImage: { url: `https://cdn.shopify.com/p${id}.jpg` },
          collections: { nodes: [] },
        }));
        return new Response(
          JSON.stringify({
            data: {
              products: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: body.query.includes('ProductIdsPage')
                  ? nodes.map((n) => ({ id: n.id }))
                  : nodes,
              },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      imageRequests++;
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'Content-Type': 'image/jpeg' },
      });
    }) as typeof fetch;

    try {
      await syncOneTask(app, { storeId: store.id, mode: 'full' });
    } finally {
      global.fetch = originalFetch;
    }

    const rows = await app.db
      .select()
      .from(schema.shopifyProductGarments)
      .where(eq(schema.shopifyProductGarments.storeId, store.id));
    expect(rows).toHaveLength(12);
    expect(rows.every((r) => r.status === 'active')).toBe(true);
    expect(rows.every((r) => r.imageUrl?.startsWith('https://cdn.shopify.com/'))).toBe(true);
    expect(imageRequests).toBe(0);
  });
});

describe('isProductSyncActive', () => {
  const now = 1_000_000_000;
  it('is active while running and recent', () => {
    expect(
      isProductSyncActive({ state: 'running', startedAt: now - 60_000, completedAt: null }, now),
    ).toBe(true);
  });
  it('is not active once idle', () => {
    expect(
      isProductSyncActive({ state: 'idle', startedAt: now - 60_000, completedAt: now - 1 }, now),
    ).toBe(false);
  });
  it('stops trusting a stale running status, so a crashed consumer cannot lock re-imports out', () => {
    expect(
      isProductSyncActive(
        { state: 'running', startedAt: now - 16 * 60 * 1000, completedAt: null },
        now,
      ),
    ).toBe(false);
  });
});

describe('syncProductNow', () => {
  it('fetches and records one product immediately, without touching the image', async () => {
    const store = await upsertShopifyStore(
      app,
      {
        shopifyShopId: 9706,
        shopDomain: 'inline.myshopify.com',
        myshopifyDomain: 'inline.myshopify.com',
        name: 'Inline Store',
        email: 'inline@s.com',
      },
      'tok',
      'read_products',
    );
    const originalFetch = global.fetch;
    const urls: string[] = [];
    global.fetch = (async (input: string | URL | Request) => {
      urls.push(String(input));
      return new Response(
        JSON.stringify({
          data: {
            product: {
              id: 'gid://shopify/Product/8123',
              title: 'Inline Shirt',
              featuredImage: { url: 'https://cdn.shopify.com/inline.jpg' },
              collections: { nodes: [] },
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;
    try {
      await syncProductNow(app, store, 8123);
    } finally {
      global.fetch = originalFetch;
    }
    const [row] = await app.db
      .select()
      .from(schema.shopifyProductGarments)
      .where(
        and(
          eq(schema.shopifyProductGarments.storeId, store.id),
          eq(schema.shopifyProductGarments.shopifyProductId, 8123),
        ),
      );
    expect(row.status).toBe('active');
    expect(row.imageUrl).toBe('https://cdn.shopify.com/inline.jpg');
    expect(urls.every((u) => u.endsWith('/graphql.json'))).toBe(true);
  });
});
