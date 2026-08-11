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

  async function seedStore() {
    const [store] = await app.db
      .insert(schema.shopifyStores)
      .values({
        shopDomain: `test-${Date.now()}-${Math.random()}.myshopify.com`,
        shopifyShopId: Date.now(),
        accessToken: 'enc',
        scope: 'read_products',
      })
      .returning();
    return store;
  }

  it('grants credits and persists plan state on first sync with an active subscription', async () => {
    const store = await seedStore();

    const result = await syncStoreSubscription(app, store, {
      getActiveSubscription: async () => sub(),
    });

    expect(result).toEqual({
      planHandle: 'growth',
      subscriptionStatus: 'active',
      creditsGranted: 5000,
    });

    const [balanceRow] = await app.db
      .select({ balance: schema.shopifyStoreCredits.balance })
      .from(schema.shopifyStoreCredits)
      .where(eq(schema.shopifyStoreCredits.storeId, store.id));
    expect(balanceRow?.balance).toBe(5000);

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
    const store = await seedStore();

    const result = await syncStoreSubscription(app, store, {
      getActiveSubscription: async () => sub({ name: '  STARTER ' }),
    });

    expect(result.planHandle).toBe('starter');
    expect(result.creditsGranted).toBe(1925);
    const [balanceRow] = await app.db
      .select({ balance: schema.shopifyStoreCredits.balance })
      .from(schema.shopifyStoreCredits)
      .where(eq(schema.shopifyStoreCredits.storeId, store.id));
    expect(balanceRow?.balance).toBe(1925);
  });

  it('does not re-grant credits on a second sync within the same billing cycle', async () => {
    const store = await seedStore();
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
      .select({ balance: schema.shopifyStoreCredits.balance })
      .from(schema.shopifyStoreCredits)
      .where(eq(schema.shopifyStoreCredits.storeId, store.id));
    expect(balanceRow?.balance).toBe(1925); // only granted once
  });

  it('grants again when the billing period advances (renewal)', async () => {
    const store = await seedStore();
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

    expect(renewed.creditsGranted).toBe(1925);
    const [balanceRow] = await app.db
      .select({ balance: schema.shopifyStoreCredits.balance })
      .from(schema.shopifyStoreCredits)
      .where(eq(schema.shopifyStoreCredits.storeId, store.id));
    expect(balanceRow?.balance).toBe(3850); // 1925 + 1925
  });

  it('grants again when the subscription id changes even if the period end does not', async () => {
    // A mid-cycle upgrade may leave the period end alone and issue a new
    // AppSubscription id instead. Shopify's exact behavior here is unverified,
    // so the cycle key covers both id and period end.
    const store = await seedStore();
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

    expect(upgraded.creditsGranted).toBe(5000);
    const [balanceRow] = await app.db
      .select({ balance: schema.shopifyStoreCredits.balance })
      .from(schema.shopifyStoreCredits)
      .where(eq(schema.shopifyStoreCredits.storeId, store.id));
    expect(balanceRow?.balance).toBe(6925); // 1925 + 5000
  });

  it('marks the store cancelled and grants nothing when there is no active subscription', async () => {
    const store = await seedStore();

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
    const store = await seedStore();

    const result = await syncStoreSubscription(app, store, {
      getActiveSubscription: async () => sub({ name: 'growth', status: 'FROZEN' }),
    });

    expect(result.subscriptionStatus).toBe('frozen');
    expect(result.creditsGranted).toBe(0);
    const [balanceRow] = await app.db
      .select({ balance: schema.shopifyStoreCredits.balance })
      .from(schema.shopifyStoreCredits)
      .where(eq(schema.shopifyStoreCredits.storeId, store.id));
    expect(balanceRow?.balance).toBeUndefined();
    const [updatedStore] = await app.db
      .select()
      .from(schema.shopifyStores)
      .where(eq(schema.shopifyStores.id, store.id));
    expect(updatedStore?.subscriptionStatus).toBe('frozen');
    // Cycle marker untouched, so the cycle is still grantable once it unfreezes.
    expect(updatedStore?.currentSubscriptionId).toBeNull();
    expect(updatedStore?.currentPeriodEnd).toBeNull();
  });

  it('does not forfeit the cycle when the plan name is unrecognized', async () => {
    // An unmapped plan name means we cannot know how many credits were paid
    // for. Grant nothing, but leave the cycle marker alone so that fixing the
    // mapping (or the Partner Dashboard name) still pays out that cycle.
    const store = await seedStore();

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

    expect(fixed.creditsGranted).toBe(5000);
    const [balanceRow] = await app.db
      .select({ balance: schema.shopifyStoreCredits.balance })
      .from(schema.shopifyStoreCredits)
      .where(eq(schema.shopifyStoreCredits.storeId, store.id));
    expect(balanceRow?.balance).toBe(5000);
  });

  it('grants nothing for a test subscription unless explicitly allowed', async () => {
    // Shopify marks a charge `test` when it will never bill — always the case on
    // a development store, which any Partner can create for free without limit.
    // Once the app is publicly installable, granting here means anyone can take
    // the top plan's credits and repeat with a fresh store.
    const store = await seedStore();

    const result = await syncStoreSubscription(app, store, {
      getActiveSubscription: async () => sub({ name: 'Pro', test: true }),
    });

    expect(result.creditsGranted).toBe(0);
    // Plan state is still recorded — an operator needs to see that the store
    // sits on a test 'pro' subscription, which is exactly the abuse signal.
    expect(result.planHandle).toBe('pro');
    expect(result.subscriptionStatus).toBe('active');

    const [balanceRow] = await app.db
      .select({ balance: schema.shopifyStoreCredits.balance })
      .from(schema.shopifyStoreCredits)
      .where(eq(schema.shopifyStoreCredits.storeId, store.id));
    expect(balanceRow?.balance).toBeUndefined();

    const ledger = await app.db
      .select()
      .from(schema.shopifyCreditLedger)
      .where(eq(schema.shopifyCreditLedger.storeId, store.id));
    expect(ledger).toHaveLength(0);

    // Marker left alone, matching the FROZEN/unmapped-plan behaviour: if the
    // same subscription later stops being a test charge, that cycle still pays.
    const [updatedStore] = await app.db
      .select()
      .from(schema.shopifyStores)
      .where(eq(schema.shopifyStores.id, store.id));
    expect(updatedStore?.currentSubscriptionId).toBeNull();
    expect(updatedStore?.currentPeriodEnd).toBeNull();
  });

  it('grants a test subscription when SHOPIFY_ALLOW_TEST_SUBSCRIPTIONS is set, tagged as test', async () => {
    // Staging and local development need this path: a dev store is the only way
    // to exercise the paid flow end to end, so refusing outright would leave
    // billing untestable everywhere.
    const permissive = await buildTestApp(c, { SHOPIFY_ALLOW_TEST_SUBSCRIPTIONS: true });
    try {
      const [store] = await permissive.db
        .insert(schema.shopifyStores)
        .values({
          shopDomain: `test-allow-${Date.now()}.myshopify.com`,
          shopifyShopId: Date.now() + 1,
          accessToken: 'enc',
          scope: 'read_products',
        })
        .returning();

      const result = await syncStoreSubscription(permissive, store, {
        getActiveSubscription: async () => sub({ name: 'Pro', test: true }),
      });

      expect(result.creditsGranted).toBe(22000);

      // Tagged distinctly so test-funded credits never masquerade as revenue
      // when the ledger is reconciled against Shopify payouts.
      const ledger = await permissive.db
        .select()
        .from(schema.shopifyCreditLedger)
        .where(eq(schema.shopifyCreditLedger.storeId, store.id));
      expect(ledger).toHaveLength(1);
      expect(ledger[0]?.reason).toBe('SHOPIFY_SUBSCRIPTION_TEST');
    } finally {
      await permissive.close();
    }
  });

  it('tags a real subscription as SHOPIFY_SUBSCRIPTION, not the test reason', async () => {
    const store = await seedStore();

    await syncStoreSubscription(app, store, {
      getActiveSubscription: async () => sub({ name: 'Growth' }),
    });

    const ledger = await app.db
      .select()
      .from(schema.shopifyCreditLedger)
      .where(eq(schema.shopifyCreditLedger.storeId, store.id));
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.reason).toBe('SHOPIFY_SUBSCRIPTION');
  });

  it('grants the admin-overridden amount when a planCredits override is configured', async () => {
    const store = await seedStore();
    await app.redis.set(
      'config:system',
      JSON.stringify({ shopify: { planCredits: { growth: 9000 } } }),
    );

    try {
      const result = await syncStoreSubscription(app, store, {
        getActiveSubscription: async () => sub({ name: 'growth' }),
      });

      expect(result.creditsGranted).toBe(9000);
      const [balanceRow] = await app.db
        .select({ balance: schema.shopifyStoreCredits.balance })
        .from(schema.shopifyStoreCredits)
        .where(eq(schema.shopifyStoreCredits.storeId, store.id));
      expect(balanceRow?.balance).toBe(9000);
    } finally {
      await app.redis.del('config:system');
    }
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

  async function seedStore() {
    const [store] = await app.db
      .insert(schema.shopifyStores)
      .values({
        shopDomain: `trial-${Date.now()}-${Math.random()}.myshopify.com`,
        shopifyShopId: Date.now(),
        accessToken: 'enc',
        scope: 'read_products',
      })
      .returning();
    return store;
  }

  it('grants the configured trial credits on first call', async () => {
    const store = await seedStore();

    const result = await grantShopifyTrialCredits(app, store);

    expect(result.creditsGranted).toBe(25);
    const [balanceRow] = await app.db
      .select({ balance: schema.shopifyStoreCredits.balance })
      .from(schema.shopifyStoreCredits)
      .where(eq(schema.shopifyStoreCredits.storeId, store.id));
    expect(balanceRow?.balance).toBe(25);
    const [ledgerRow] = await app.db
      .select({
        reason: schema.shopifyCreditLedger.reason,
        externalRef: schema.shopifyCreditLedger.externalRef,
      })
      .from(schema.shopifyCreditLedger)
      .where(eq(schema.shopifyCreditLedger.storeId, store.id));
    expect(ledgerRow?.reason).toBe('SHOPIFY_TRIAL');
    expect(ledgerRow?.externalRef).toBe(`shopify_trial:${store.id}`);
  });

  it('does not re-grant on a second call for the same store', async () => {
    const store = await seedStore();
    await grantShopifyTrialCredits(app, store);

    const second = await grantShopifyTrialCredits(app, store);

    expect(second.creditsGranted).toBe(0);
    const [balanceRow] = await app.db
      .select({ balance: schema.shopifyStoreCredits.balance })
      .from(schema.shopifyStoreCredits)
      .where(eq(schema.shopifyStoreCredits.storeId, store.id));
    expect(balanceRow?.balance).toBe(25); // only granted once
  });

  it('grants again for a second, different store', async () => {
    const firstStore = await seedStore();
    await grantShopifyTrialCredits(app, firstStore);

    const [secondStore] = await app.db
      .insert(schema.shopifyStores)
      .values({
        shopDomain: `trial-2nd-${Date.now()}-${Math.random()}.myshopify.com`,
        shopifyShopId: Date.now() + 1,
        accessToken: 'enc',
        scope: 'read_products',
      })
      .returning();

    const result = await grantShopifyTrialCredits(app, secondStore!);

    expect(result.creditsGranted).toBe(25);
    const [balanceRow] = await app.db
      .select({ balance: schema.shopifyStoreCredits.balance })
      .from(schema.shopifyStoreCredits)
      .where(eq(schema.shopifyStoreCredits.storeId, secondStore!.id));
    expect(balanceRow?.balance).toBe(25);
  });

  it('short-circuits without a DB write when the admin sets trial credits to 0', async () => {
    const store = await seedStore();
    await app.redis.set('config:system', JSON.stringify({ shopify: { trialCredits: 0 } }));

    try {
      const result = await grantShopifyTrialCredits(app, store);
      expect(result.creditsGranted).toBe(0);
      const ledgerRows = await app.db
        .select()
        .from(schema.shopifyCreditLedger)
        .where(eq(schema.shopifyCreditLedger.storeId, store.id));
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
