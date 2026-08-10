import { schema } from '@aivastra/db';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as billing from '../../src/modules/shopify/billing.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';
import { signSessionToken } from '../helpers/shopify-session.js';

const API_SECRET = 'test-secret';
const API_KEY = 'test-key';

describe('GET /v1/shopify/billing/confirm', () => {
  let c: Containers;
  let app: TestApp;
  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c, {
      SHOPIFY_API_SECRET: API_SECRET,
      SHOPIFY_API_KEY: API_KEY,
    });
  }, 60000);
  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  it('re-syncs the calling store and returns its plan state', async () => {
    const [user] = await app.db
      .insert(schema.users)
      .values({
        email: `owner-${Date.now()}@example.com`,
        passwordHash: null,
        displayName: 'Owner',
        companyName: null,
        emailVerified: true,
        tier: 'free',
      })
      .returning();
    await app.db.insert(schema.userCredits).values({ userId: user.id, balance: 0 });
    const [store] = await app.db
      .insert(schema.shopifyStores)
      .values({
        shopDomain: 'confirm-test.myshopify.com',
        shopifyShopId: 424242,
        accessToken: 'enc',
        scope: 'read_products',
        ownerUserId: user.id,
      })
      .returning();

    const syncSpy = vi.spyOn(billing, 'syncStoreSubscription').mockResolvedValue({
      planHandle: 'pro',
      subscriptionStatus: 'active',
      creditsGranted: 25000,
    });

    const token = signSessionToken(store.shopDomain, API_SECRET, API_KEY);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/shopify/billing/confirm',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    // The owner's userCredits row exists (balance 0) and syncStoreSubscription
    // is mocked, so the route reports the real balance it read back, not the
    // mocked creditsGranted from the sync call.
    expect(res.json()).toEqual({
      planHandle: 'pro',
      subscriptionStatus: 'active',
      creditBalance: 0,
    });
    expect(syncSpy).toHaveBeenCalledWith(
      app.db,
      app.env,
      expect.objectContaining({ id: store.id }),
    );

    syncSpy.mockRestore();
  });

  it('rejects a request with no session token', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/shopify/billing/confirm' });
    expect(res.statusCode).toBe(401);
  });

  it('reports a null credit balance for a store with no linked owner', async () => {
    const [store] = await app.db
      .insert(schema.shopifyStores)
      .values({
        shopDomain: 'confirm-unlinked.myshopify.com',
        shopifyShopId: 424243,
        accessToken: 'enc',
        scope: 'read_products',
      })
      .returning();

    const syncSpy = vi.spyOn(billing, 'syncStoreSubscription').mockResolvedValue({
      planHandle: null,
      subscriptionStatus: 'cancelled',
      creditsGranted: 0,
    });

    const token = signSessionToken(store.shopDomain, API_SECRET, API_KEY);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/shopify/billing/confirm',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      planHandle: null,
      subscriptionStatus: 'cancelled',
      creditBalance: null,
    });

    syncSpy.mockRestore();
  });
});
