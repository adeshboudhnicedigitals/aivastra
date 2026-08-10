import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildPlanSelectionUrl,
  grantShopifyTrialCredits,
  syncStoreSubscription,
} from '../../src/modules/shopify/billing.js';
import type { ActiveSubscription } from '../../src/modules/shopify/subscription-client.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

/**
 * Shape of what the Admin API's currentAppInstallation.activeSubscriptions
 * returns for one subscription. Every test stubs getActiveSubscription with
 * this rather than the network.
 */
function sub(overrides: Partial<ActiveSubscription> = {}): ActiveSubscription {
  return {
    id: 'gid://shopify/AppSubscription/1',
    name: 'Growth',
    status: 'ACTIVE',
    currentPeriodEnd: '2026-08-31T00:00:00Z',
    test: false,
    lineItems: [{ id: 'gid://shopify/AppSubscriptionLineItem/1' }],
    ...overrides,
  };
}

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

  it('grants credits and persists plan state on first sync with an active subscription', async () => {
    const { user, store } = await seedOwnerAndStore();

    const result = await syncStoreSubscription(app, store, {
      getActiveSubscription: async () => sub(),
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
    expect(updatedStore?.currentSubscriptionId).toBe('gid://shopify/AppSubscription/1');
    expect(updatedStore?.currentPeriodEnd?.toISOString()).toBe('2026-08-31T00:00:00.000Z');
  });

  it('matches the plan name case-insensitively', async () => {
    // We do not control how the plan gets capitalized in Partner Dashboard.
    const { user, store } = await seedOwnerAndStore();

    const result = await syncStoreSubscription(app, store, {
      getActiveSubscription: async () => sub({ name: '  STARTER ' }),
    });

    expect(result.planHandle).toBe('starter');
    expect(result.creditsGranted).toBe(2500);
    const [balanceRow] = await app.db
      .select({ balance: schema.userCredits.balance })
      .from(schema.userCredits)
      .where(eq(schema.userCredits.userId, user.id));
    expect(balanceRow?.balance).toBe(2500);
  });

  it('does not re-grant credits on a second sync within the same billing cycle', async () => {
    const { user, store } = await seedOwnerAndStore();
    const activeSub = sub({ name: 'starter' });
    await syncStoreSubscription(app, store, { getActiveSubscription: async () => activeSub });
    const [restored] = await app.db
      .select()
      .from(schema.shopifyStores)
      .where(eq(schema.shopifyStores.id, store.id));

    const second = await syncStoreSubscription(app, restored!, {
      getActiveSubscription: async () => activeSub,
    });

    expect(second.creditsGranted).toBe(0);
    const [balanceRow] = await app.db
      .select({ balance: schema.userCredits.balance })
      .from(schema.userCredits)
      .where(eq(schema.userCredits.userId, user.id));
    expect(balanceRow?.balance).toBe(2500); // only granted once
  });

  it('grants again when the billing period advances (renewal)', async () => {
    const { user, store } = await seedOwnerAndStore();
    await syncStoreSubscription(app, store, {
      getActiveSubscription: async () => sub({ name: 'starter' }),
    });
    const [afterFirst] = await app.db
      .select()
      .from(schema.shopifyStores)
      .where(eq(schema.shopifyStores.id, store.id));

    const renewed = await syncStoreSubscription(app, afterFirst!, {
      getActiveSubscription: async () =>
        sub({ name: 'starter', currentPeriodEnd: '2026-09-30T00:00:00Z' }),
    });

    expect(renewed.creditsGranted).toBe(2500);
    const [balanceRow] = await app.db
      .select({ balance: schema.userCredits.balance })
      .from(schema.userCredits)
      .where(eq(schema.userCredits.userId, user.id));
    expect(balanceRow?.balance).toBe(5000); // 2500 + 2500
  });

  it('grants again when the subscription id changes even if the period end does not', async () => {
    // A mid-cycle upgrade may leave the period end alone and issue a new
    // AppSubscription id instead. Shopify's exact behavior here is unverified,
    // so the cycle key covers both id and period end.
    const { user, store } = await seedOwnerAndStore();
    await syncStoreSubscription(app, store, {
      getActiveSubscription: async () => sub({ name: 'starter' }),
    });
    const [afterFirst] = await app.db
      .select()
      .from(schema.shopifyStores)
      .where(eq(schema.shopifyStores.id, store.id));

    const upgraded = await syncStoreSubscription(app, afterFirst!, {
      getActiveSubscription: async () =>
        sub({ id: 'gid://shopify/AppSubscription/2', name: 'growth' }),
    });

    expect(upgraded.creditsGranted).toBe(6250);
    const [balanceRow] = await app.db
      .select({ balance: schema.userCredits.balance })
      .from(schema.userCredits)
      .where(eq(schema.userCredits.userId, user.id));
    expect(balanceRow?.balance).toBe(8750); // 2500 + 6250
  });

  it('marks the store cancelled and grants nothing when there is no active subscription', async () => {
    const { store } = await seedOwnerAndStore();

    const result = await syncStoreSubscription(app, store, {
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

  it('persists the real status and grants nothing for a non-ACTIVE subscription', async () => {
    // Previously the status was hardcoded to 'active' for any non-null
    // subscription, so a frozen shop looked healthy and got credited.
    const { user, store } = await seedOwnerAndStore();

    const result = await syncStoreSubscription(app, store, {
      getActiveSubscription: async () => sub({ name: 'growth', status: 'FROZEN' }),
    });

    expect(result.subscriptionStatus).toBe('frozen');
    expect(result.creditsGranted).toBe(0);
    const [balanceRow] = await app.db
      .select({ balance: schema.userCredits.balance })
      .from(schema.userCredits)
      .where(eq(schema.userCredits.userId, user.id));
    expect(balanceRow?.balance).toBe(0);
    const [updatedStore] = await app.db
      .select()
      .from(schema.shopifyStores)
      .where(eq(schema.shopifyStores.id, store.id));
    expect(updatedStore?.subscriptionStatus).toBe('frozen');
    // Cycle marker untouched, so the cycle is still grantable once it unfreezes.
    expect(updatedStore?.currentSubscriptionId).toBeNull();
    expect(updatedStore?.currentPeriodEnd).toBeNull();
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

    const result = await syncStoreSubscription(app, store!, {
      getActiveSubscription: async () => sub({ name: 'pro' }),
    });

    expect(result.creditsGranted).toBe(0);
  });

  it('grants credits for the still-unbilled cycle once an owner-less store gets linked to an owner', async () => {
    // Regression: the trailing store update used to advance the cycle marker
    // unconditionally, even when ownerUserId was null and no grant could
    // happen. That permanently marked the cycle "seen," so a later sync after
    // the store got linked to an owner would see isNewCycle === false and never
    // grant credits the merchant actually paid for. The marker must only
    // advance when there was someone to grant to.
    const [store] = await app.db
      .insert(schema.shopifyStores)
      .values({
        shopDomain: `unlinked-renewal-${Date.now()}.myshopify.com`,
        shopifyShopId: Date.now(),
        accessToken: 'enc',
        scope: 'read_products',
      })
      .returning();
    const activeSub = sub({ name: 'starter' });

    const first = await syncStoreSubscription(app, store!, {
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

    const second = await syncStoreSubscription(app, linked!, {
      getActiveSubscription: async () => activeSub,
    });

    expect(second.creditsGranted).toBe(2500);
    const [balanceRow] = await app.db
      .select({ balance: schema.userCredits.balance })
      .from(schema.userCredits)
      .where(eq(schema.userCredits.userId, user.id));
    expect(balanceRow?.balance).toBe(2500);
  });

  it('does not forfeit the cycle when the plan name is unrecognized', async () => {
    // An unmapped plan name means we cannot know how many credits were paid
    // for. Grant nothing, but leave the cycle marker alone so that fixing the
    // mapping (or the Partner Dashboard name) still pays out that cycle.
    const { user, store } = await seedOwnerAndStore();

    const unmapped = await syncStoreSubscription(app, store, {
      getActiveSubscription: async () => sub({ name: 'Enterprise' }),
    });
    expect(unmapped.creditsGranted).toBe(0);
    expect(unmapped.planHandle).toBe('enterprise');

    const [afterUnmapped] = await app.db
      .select()
      .from(schema.shopifyStores)
      .where(eq(schema.shopifyStores.id, store.id));
    expect(afterUnmapped?.currentSubscriptionId).toBeNull();
    expect(afterUnmapped?.currentPeriodEnd).toBeNull();

    const fixed = await syncStoreSubscription(app, afterUnmapped!, {
      getActiveSubscription: async () => sub({ name: 'Growth' }),
    });

    expect(fixed.creditsGranted).toBe(6250);
    const [balanceRow] = await app.db
      .select({ balance: schema.userCredits.balance })
      .from(schema.userCredits)
      .where(eq(schema.userCredits.userId, user.id));
    expect(balanceRow?.balance).toBe(6250);
  });
});

describe('grantShopifyTrialCredits', () => {
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
        email: `trial-owner-${Date.now()}-${Math.random()}@example.com`,
        passwordHash: null,
        displayName: 'Trial Store Owner',
        companyName: null,
        emailVerified: true,
        tier: 'free',
      })
      .returning();
    const [store] = await app.db
      .insert(schema.shopifyStores)
      .values({
        shopDomain: `trial-${Date.now()}-${Math.random()}.myshopify.com`,
        shopifyShopId: Date.now(),
        accessToken: 'enc',
        scope: 'read_products',
        ownerUserId: user.id,
      })
      .returning();
    return { user, store };
  }

  it('grants the configured trial credits on first call', async () => {
    const { user, store } = await seedOwnerAndStore();

    const result = await grantShopifyTrialCredits(app, store, user.id);

    expect(result.creditsGranted).toBe(25);
    const [balanceRow] = await app.db
      .select({ balance: schema.userCredits.balance })
      .from(schema.userCredits)
      .where(eq(schema.userCredits.userId, user.id));
    expect(balanceRow?.balance).toBe(25);
    const [ledgerRow] = await app.db
      .select({ reason: schema.creditLedger.reason, externalRef: schema.creditLedger.externalRef })
      .from(schema.creditLedger)
      .where(eq(schema.creditLedger.userId, user.id));
    expect(ledgerRow?.reason).toBe('SHOPIFY_TRIAL');
    expect(ledgerRow?.externalRef).toBe(`shopify_trial:${store.id}`);
  });

  it('does not re-grant on a second call for the same store', async () => {
    const { user, store } = await seedOwnerAndStore();
    await grantShopifyTrialCredits(app, store, user.id);

    const second = await grantShopifyTrialCredits(app, store, user.id);

    expect(second.creditsGranted).toBe(0);
    const [balanceRow] = await app.db
      .select({ balance: schema.userCredits.balance })
      .from(schema.userCredits)
      .where(eq(schema.userCredits.userId, user.id));
    expect(balanceRow?.balance).toBe(25); // only granted once
  });

  it('grants again for a second, different store linked to the same owner', async () => {
    const { user, store: firstStore } = await seedOwnerAndStore();
    await grantShopifyTrialCredits(app, firstStore, user.id);

    const [secondStore] = await app.db
      .insert(schema.shopifyStores)
      .values({
        shopDomain: `trial-2nd-${Date.now()}-${Math.random()}.myshopify.com`,
        shopifyShopId: Date.now() + 1,
        accessToken: 'enc',
        scope: 'read_products',
        ownerUserId: user.id,
      })
      .returning();

    const result = await grantShopifyTrialCredits(app, secondStore!, user.id);

    expect(result.creditsGranted).toBe(25);
    const [balanceRow] = await app.db
      .select({ balance: schema.userCredits.balance })
      .from(schema.userCredits)
      .where(eq(schema.userCredits.userId, user.id));
    expect(balanceRow?.balance).toBe(50); // 25 + 25, one per store
  });

  it('short-circuits without a DB write when the admin sets trial credits to 0', async () => {
    const { user, store } = await seedOwnerAndStore();
    await app.redis.set('config:system', JSON.stringify({ shopify: { trialCredits: 0 } }));

    try {
      const result = await grantShopifyTrialCredits(app, store, user.id);
      expect(result.creditsGranted).toBe(0);
      const ledgerRows = await app.db
        .select()
        .from(schema.creditLedger)
        .where(eq(schema.creditLedger.userId, user.id));
      expect(ledgerRows).toHaveLength(0);
    } finally {
      await app.redis.del('config:system');
    }
  });
});

describe('buildPlanSelectionUrl', () => {
  it('builds the Shopify-hosted plan picker URL from shop domain and app handle', () => {
    expect(buildPlanSelectionUrl('cool-shop.myshopify.com', 'aivastra')).toBe(
      'https://admin.shopify.com/store/cool-shop/charges/aivastra/pricing_plans',
    );
  });
});
