import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildPlanSelectionUrl, syncStoreSubscription } from '../../src/modules/shopify/billing.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

describe('syncStoreSubscription', () => {
  let c: Containers;
  let app: TestApp;
  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
  }, 60000);
  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  async function seedOwnerAndStore() {
    const [user] = await app.db
      .insert(schema.users)
      .values({
        email: `owner-${Date.now()}-${Math.random()}@example.com`,
        passwordHash: null,
        displayName: 'Store Owner',
        companyName: null,
        emailVerified: true,
        tier: 'free',
      })
      .returning();
    await app.db.insert(schema.userCredits).values({ userId: user.id, balance: 0 });
    const [store] = await app.db
      .insert(schema.shopifyStores)
      .values({
        shopDomain: `test-${Date.now()}-${Math.random()}.myshopify.com`,
        shopifyShopId: Date.now(),
        accessToken: 'enc',
        scope: 'read_products',
        ownerUserId: user.id,
      })
      .returning();
    return { user, store };
  }

  const partnerEnv = {
    SHOPIFY_PARTNER_API_TOKEN: 'tok',
    SHOPIFY_PARTNER_ORG_ID: '1',
    SHOPIFY_PARTNER_APP_GID: 'gid://shopify/App/1',
  };

  it('grants credits and persists plan state on first sync with an active subscription', async () => {
    const { user, store } = await seedOwnerAndStore();

    const result = await syncStoreSubscription(app.db, partnerEnv, store, {
      getActiveSubscription: async () => ({
        billingPeriod: 'EVERY_30_DAYS',
        cancelAtEndOfCycle: false,
        currentBillingCycle: { startTime: '2026-08-01T00:00:00Z', endTime: '2026-08-31T00:00:00Z' },
        items: [{ handle: 'growth' }],
      }),
    });

    expect(result).toEqual({
      planHandle: 'growth',
      subscriptionStatus: 'active',
      creditsGranted: 6250,
    });

    const [balanceRow] = await app.db
      .select({ balance: schema.userCredits.balance })
      .from(schema.userCredits)
      .where(eq(schema.userCredits.userId, user.id));
    expect(balanceRow?.balance).toBe(6250);

    const [updatedStore] = await app.db
      .select()
      .from(schema.shopifyStores)
      .where(eq(schema.shopifyStores.id, store.id));
    expect(updatedStore?.planHandle).toBe('growth');
    expect(updatedStore?.subscriptionStatus).toBe('active');
    expect(updatedStore?.currentBillingCycleStart?.toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });

  it('does not re-grant credits on a second sync within the same billing cycle', async () => {
    const { user, store } = await seedOwnerAndStore();
    const activeSub = {
      billingPeriod: 'EVERY_30_DAYS',
      cancelAtEndOfCycle: false,
      currentBillingCycle: { startTime: '2026-08-01T00:00:00Z', endTime: '2026-08-31T00:00:00Z' },
      items: [{ handle: 'starter' }],
    };
    await syncStoreSubscription(app.db, partnerEnv, store, {
      getActiveSubscription: async () => activeSub,
    });
    const [restored] = await app.db
      .select()
      .from(schema.shopifyStores)
      .where(eq(schema.shopifyStores.id, store.id));

    const second = await syncStoreSubscription(app.db, partnerEnv, restored!, {
      getActiveSubscription: async () => activeSub,
    });

    expect(second.creditsGranted).toBe(0);
    const [balanceRow] = await app.db
      .select({ balance: schema.userCredits.balance })
      .from(schema.userCredits)
      .where(eq(schema.userCredits.userId, user.id));
    expect(balanceRow?.balance).toBe(2500); // only granted once
  });

  it('grants again when the billing cycle advances (renewal)', async () => {
    const { user, store } = await seedOwnerAndStore();
    await syncStoreSubscription(app.db, partnerEnv, store, {
      getActiveSubscription: async () => ({
        billingPeriod: 'EVERY_30_DAYS',
        cancelAtEndOfCycle: false,
        currentBillingCycle: { startTime: '2026-08-01T00:00:00Z', endTime: '2026-08-31T00:00:00Z' },
        items: [{ handle: 'starter' }],
      }),
    });
    const [afterFirst] = await app.db
      .select()
      .from(schema.shopifyStores)
      .where(eq(schema.shopifyStores.id, store.id));

    const renewed = await syncStoreSubscription(app.db, partnerEnv, afterFirst!, {
      getActiveSubscription: async () => ({
        billingPeriod: 'EVERY_30_DAYS',
        cancelAtEndOfCycle: false,
        currentBillingCycle: { startTime: '2026-08-31T00:00:00Z', endTime: '2026-09-30T00:00:00Z' },
        items: [{ handle: 'starter' }],
      }),
    });

    expect(renewed.creditsGranted).toBe(2500);
    const [balanceRow] = await app.db
      .select({ balance: schema.userCredits.balance })
      .from(schema.userCredits)
      .where(eq(schema.userCredits.userId, user.id));
    expect(balanceRow?.balance).toBe(5000); // 2500 + 2500
  });

  it('marks the store cancelled and grants nothing when there is no active subscription', async () => {
    const { store } = await seedOwnerAndStore();

    const result = await syncStoreSubscription(app.db, partnerEnv, store, {
      getActiveSubscription: async () => null,
    });

    expect(result).toEqual({
      planHandle: null,
      subscriptionStatus: 'cancelled',
      creditsGranted: 0,
    });
    const [updatedStore] = await app.db
      .select()
      .from(schema.shopifyStores)
      .where(eq(schema.shopifyStores.id, store.id));
    expect(updatedStore?.subscriptionStatus).toBe('cancelled');
  });

  it('grants nothing for a store with no owner yet (unlinked account)', async () => {
    const [store] = await app.db
      .insert(schema.shopifyStores)
      .values({
        shopDomain: `unlinked-${Date.now()}.myshopify.com`,
        shopifyShopId: Date.now(),
        accessToken: 'enc',
        scope: 'read_products',
      })
      .returning();

    const result = await syncStoreSubscription(app.db, partnerEnv, store!, {
      getActiveSubscription: async () => ({
        billingPeriod: 'EVERY_30_DAYS',
        cancelAtEndOfCycle: false,
        currentBillingCycle: { startTime: '2026-08-01T00:00:00Z', endTime: '2026-08-31T00:00:00Z' },
        items: [{ handle: 'pro' }],
      }),
    });

    expect(result.creditsGranted).toBe(0);
  });

  it('grants credits for the still-unbilled cycle once an owner-less store gets linked to an owner', async () => {
    // Regression: the trailing store update used to advance
    // currentBillingCycleStart unconditionally, even when ownerUserId was
    // null and no grant could happen. That permanently marked the cycle
    // "seen," so a later sync after the store got linked to an owner would
    // see isNewCycle === false and never grant credits the merchant actually
    // paid for. currentBillingCycleStart must only advance when there was an
    // owner to grant to.
    const [store] = await app.db
      .insert(schema.shopifyStores)
      .values({
        shopDomain: `unlinked-renewal-${Date.now()}.myshopify.com`,
        shopifyShopId: Date.now(),
        accessToken: 'enc',
        scope: 'read_products',
      })
      .returning();
    const activeSub = {
      billingPeriod: 'EVERY_30_DAYS',
      cancelAtEndOfCycle: false,
      currentBillingCycle: { startTime: '2026-08-01T00:00:00Z', endTime: '2026-08-31T00:00:00Z' },
      items: [{ handle: 'starter' }],
    };

    const first = await syncStoreSubscription(app.db, partnerEnv, store!, {
      getActiveSubscription: async () => activeSub,
    });
    expect(first.creditsGranted).toBe(0);

    const [user] = await app.db
      .insert(schema.users)
      .values({
        email: `owner-${Date.now()}-${Math.random()}@example.com`,
        passwordHash: null,
        displayName: 'Store Owner',
        companyName: null,
        emailVerified: true,
        tier: 'free',
      })
      .returning();
    await app.db.insert(schema.userCredits).values({ userId: user.id, balance: 0 });
    await app.db
      .update(schema.shopifyStores)
      .set({ ownerUserId: user.id })
      .where(eq(schema.shopifyStores.id, store!.id));
    const [linked] = await app.db
      .select()
      .from(schema.shopifyStores)
      .where(eq(schema.shopifyStores.id, store!.id));

    const second = await syncStoreSubscription(app.db, partnerEnv, linked!, {
      getActiveSubscription: async () => activeSub,
    });

    expect(second.creditsGranted).toBe(2500);
    const [balanceRow] = await app.db
      .select({ balance: schema.userCredits.balance })
      .from(schema.userCredits)
      .where(eq(schema.userCredits.userId, user.id));
    expect(balanceRow?.balance).toBe(2500);
  });
});

describe('buildPlanSelectionUrl', () => {
  it('builds the Shopify-hosted plan picker URL from shop domain and app handle', () => {
    expect(buildPlanSelectionUrl('cool-shop.myshopify.com', 'aivastra')).toBe(
      'https://admin.shopify.com/store/cool-shop/charges/aivastra/pricing_plans',
    );
  });
});
