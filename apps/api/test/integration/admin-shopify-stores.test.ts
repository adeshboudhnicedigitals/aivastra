import { schema } from '@aivastra/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminAuthHeader } from '../helpers/admin.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { createVerifiedUserToken } from '../helpers/auth.js';
import { type Containers, startContainers } from '../helpers/containers.js';

describe('admin Shopify Stores routes', () => {
  let c: Containers;
  let app: TestApp;
  let adminAuth: Record<string, string>;
  let nonAdminAuth: Record<string, string>;
  let creditedStoreId: string;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
    adminAuth = await adminAuthHeader(app, 'SUPER_ADMIN');
    const { token } = await createVerifiedUserToken(app, 'shopify-stores-non-admin@x.com', {
      audience: 'admin',
    });
    nonAdminAuth = { authorization: `Bearer ${token}` };

    const nonce = crypto.randomUUID();
    const [creditedStore] = await app.db
      .insert(schema.shopifyStores)
      .values({
        shopDomain: `credited-${nonce}.myshopify.com`,
        shopifyShopId: Math.floor(Math.random() * 1_000_000_000),
        accessToken: 'enc:credited',
        scope: 'read_products',
        installedAt: new Date('2026-08-10T10:00:00Z'),
      })
      .returning({ id: schema.shopifyStores.id });
    const [emptyStore] = await app.db
      .insert(schema.shopifyStores)
      .values({
        shopDomain: `empty-${nonce}.myshopify.com`,
        shopifyShopId: Math.floor(Math.random() * 1_000_000_000) + 1_000_000_000,
        accessToken: 'enc:empty',
        scope: 'read_products',
        installedAt: new Date('2026-08-09T10:00:00Z'),
        uninstalledAt: new Date('2026-08-10T10:00:00Z'),
      })
      .returning({ id: schema.shopifyStores.id });
    expect(creditedStore).toBeDefined();
    expect(emptyStore).toBeDefined();
    creditedStoreId = creditedStore.id;

    await app.db.insert(schema.shopifyStoreCredits).values({
      storeId: creditedStoreId,
      balance: 42,
    });
    await app.db.insert(schema.shopifyCreditLedger).values([
      {
        storeId: creditedStoreId,
        delta: 25,
        reason: 'SHOPIFY_TRIAL',
        externalRef: `trial:${nonce}`,
        createdAt: new Date('2026-08-10T10:00:00Z'),
      },
      {
        storeId: creditedStoreId,
        delta: -3,
        reason: 'JOB_DEDUCT',
        jobId: crypto.randomUUID(),
        createdAt: new Date('2026-08-10T11:00:00Z'),
      },
      {
        storeId: creditedStoreId,
        delta: 20,
        reason: 'SHOPIFY_SUBSCRIPTION_CYCLE',
        externalRef: `cycle:${nonce}`,
        createdAt: new Date('2026-08-10T12:00:00Z'),
      },
    ]);

    // Manage-page mirror fixtures: one individually enabled product, one failed
    // product that is also excluded, one enabled collection.
    await app.db.insert(schema.shopifyProductGarments).values([
      {
        storeId: creditedStoreId,
        shopifyProductId: 1001,
        r2Key: `test/${nonce}/1001.png`,
        title: 'Enabled dress',
        status: 'active',
        enabled: true,
      },
      {
        storeId: creditedStoreId,
        shopifyProductId: 1002,
        r2Key: `test/${nonce}/1002.png`,
        title: 'Broken kurta',
        status: 'failed',
        failedReason: 'image download failed',
        excluded: true,
      },
    ]);
    await app.db.insert(schema.shopifyCollections).values({
      storeId: creditedStoreId,
      shopifyCollectionId: 77,
      title: 'Summer',
    });
    await app.db
      .insert(schema.shopifyEnabledCollections)
      .values({ storeId: creditedStoreId, shopifyCollectionId: 77 });
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  it('lists Shopify stores with their store-scoped credit balances', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/shopify-stores',
      headers: adminAuth,
    });

    expect(res.statusCode).toBe(200);
    const stores = res.json().stores as Array<{
      id: string;
      shopDomain: string;
      balance: number;
      installedAt: string;
      uninstalledAt: string | null;
    }>;
    const credited = stores.find((store) => store.id === creditedStoreId);
    const empty = stores.find((store) => store.shopDomain.startsWith('empty-'));
    expect(credited).toMatchObject({ balance: 42 });
    expect(empty).toMatchObject({ balance: 0 });
  });

  it('lists a Shopify store ledger newest first', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/admin/shopify-stores/${creditedStoreId}/ledger`,
      headers: adminAuth,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      entries: Array<{ delta: number; reason: string; createdAt: string }>;
      nextCursor: string | null;
    };
    expect(body.entries.map((entry) => entry.reason)).toEqual([
      'SHOPIFY_SUBSCRIPTION_CYCLE',
      'JOB_DEDUCT',
      'SHOPIFY_TRIAL',
    ]);
    expect(body.entries.map((entry) => entry.delta)).toEqual([20, -3, 25]);
    expect(body.nextCursor).toBeNull();
  });

  it("mirrors a store's Manage page state without calling Shopify", async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/admin/shopify-stores/${creditedStoreId}/manage`,
      headers: adminAuth,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.mode).toBe('selective');
    expect(body.counts).toMatchObject({
      enabledCollections: 1,
      excludedCollections: 0,
      failedToSync: 1,
      syncedProductCount: 1,
    });
    expect(body.statusCounts).toEqual({ active: 1, failed: 1 });
    expect(body.enabledCollections).toEqual([
      { shopifyCollectionId: 77, title: 'Summer', productCount: 0 },
    ]);
    expect(body.lastSyncedAt).not.toBeNull();
  });

  it("filters a store's synced products like the merchant list does", async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/admin/shopify-stores/${creditedStoreId}/products?excluded=true`,
      headers: adminAuth,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(1);
    expect(body.items[0]).toMatchObject({
      shopifyProductId: 1002,
      status: 'failed',
      failedReason: 'image download failed',
      excluded: true,
      enabled: false,
    });
    expect(body.items[0].thumbnailUrl).toEqual(expect.any(String));
  });

  it('404s the Manage mirror for an unknown store and forbids non-admins', async () => {
    const missing = await app.inject({
      method: 'GET',
      url: `/admin/shopify-stores/${crypto.randomUUID()}/manage`,
      headers: adminAuth,
    });
    const forbidden = await app.inject({
      method: 'GET',
      url: `/admin/shopify-stores/${creditedStoreId}/products`,
      headers: nonAdminAuth,
    });

    expect(missing.statusCode).toBe(404);
    expect(forbidden.statusCode).toBe(403);
  });

  it('queues a full product sync once, reports it running, and refuses a duplicate', async () => {
    const url = `/admin/shopify-stores/${creditedStoreId}/sync`;
    const first = await app.inject({ method: 'POST', url, headers: adminAuth });
    expect(first.statusCode).toBe(202);
    expect(first.json()).toEqual({ queued: true });

    const status = await app.inject({
      method: 'GET',
      url: `${url}/status`,
      headers: adminAuth,
    });
    expect(status.json().state).toBe('running');

    const second = await app.inject({ method: 'POST', url, headers: adminAuth });
    expect(second.json()).toEqual({ queued: false, alreadyRunning: true });
  });

  it('404s a sync for an unknown store and forbids non-admins', async () => {
    const missing = await app.inject({
      method: 'POST',
      url: `/admin/shopify-stores/${crypto.randomUUID()}/sync`,
      headers: adminAuth,
    });
    const forbidden = await app.inject({
      method: 'POST',
      url: `/admin/shopify-stores/${creditedStoreId}/sync`,
      headers: nonAdminAuth,
    });
    expect(missing.statusCode).toBe(404);
    expect(forbidden.statusCode).toBe(403);
  });

  it('forbids non-admin sessions from both routes', async () => {
    const listRes = await app.inject({
      method: 'GET',
      url: '/admin/shopify-stores',
      headers: nonAdminAuth,
    });
    const ledgerRes = await app.inject({
      method: 'GET',
      url: `/admin/shopify-stores/${creditedStoreId}/ledger`,
      headers: nonAdminAuth,
    });

    expect(listRes.statusCode).toBe(403);
    expect(ledgerRes.statusCode).toBe(403);
  });
});
