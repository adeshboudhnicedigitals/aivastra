import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { upsertShopifyStore } from '../src/modules/shopify/auth.routes.js';
import { activateCharge } from '../src/modules/shopify/billing.routes.js';
import { buildTestApp, type TestApp } from './helpers/api.js';
import { type Containers, startContainers } from './helpers/containers.js';

const ENC_KEY = Buffer.alloc(32, 4).toString('base64');
let c: Containers;
let app: TestApp;
let storeId: string;
let planId: string;

beforeAll(async () => {
  c = await startContainers();
  app = await buildTestApp(c, { SHOPIFY_TOKEN_ENC_KEY: ENC_KEY, SHOPIFY_JOB_COST: 10 });
  const store = await upsertShopifyStore(
    app,
    {
      shopifyShopId: 33,
      shopDomain: 'b.myshopify.com',
      myshopifyDomain: 'b.myshopify.com',
      name: 'B',
      email: 'b@b.com',
    },
    'tok',
    'read_products',
  );
  storeId = store.id;
  const [plan] = await app.db
    .insert(schema.shopifyPlans)
    .values({ name: 'Trend', priceCents: 1999, includedTryons: 100, overageCents: 16 })
    .returning();
  planId = plan.id;
});
afterAll(async () => {
  await app?.close();
  await c?.stop();
});

describe('billing activation', () => {
  it('links store to plan on activate', async () => {
    await activateCharge(app, storeId, planId, 55555 /* shopify charge id */);
    const [store] = await app.db
      .select()
      .from(schema.shopifyStores)
      .where(eq(schema.shopifyStores.id, storeId));
    expect(store.shopifyPlanId).toBe(planId);
    expect(store.billingPlanId).toBe(55555);
  });

  it('is replay-safe: same chargeId is a no-op', async () => {
    await activateCharge(app, storeId, planId, 55555 /* same charge id as above */);
    const [store] = await app.db
      .select()
      .from(schema.shopifyStores)
      .where(eq(schema.shopifyStores.id, storeId));
    expect(store.billingPlanId).toBe(55555);
    expect(store.shopifyPlanId).toBe(planId);

    const [plan2] = await app.db
      .insert(schema.shopifyPlans)
      .values({ name: 'Growth', priceCents: 4999, includedTryons: 50, overageCents: 16 })
      .returning();
    await activateCharge(app, storeId, plan2.id, 66666 /* new charge id */);
    const [updated] = await app.db
      .select()
      .from(schema.shopifyStores)
      .where(eq(schema.shopifyStores.id, storeId));
    expect(updated.shopifyPlanId).toBe(plan2.id);
    expect(updated.billingPlanId).toBe(66666);
  });

  it('is concurrency-safe: two near-simultaneous calls for the same chargeId update only once', async () => {
    // Regression test for the row-lock fix. Without `.for('update')` on the initial
    // SELECT inside the transaction, two concurrent calls can both read the store row
    // before either commits, both see a non-matching billingPlanId, and both apply the
    // update — double-crediting (if credits were still in play). The row lock forces the
    // second transaction to block until the first commits, at which point it re-reads
    // the already-updated billingPlanId and takes the no-op replay path.
    const store = await upsertShopifyStore(
      app,
      {
        shopifyShopId: 34,
        shopDomain: 'c.myshopify.com',
        myshopifyDomain: 'c.myshopify.com',
        name: 'C',
        email: 'c@c.com',
      },
      'tok',
      'read_products',
    );
    const [plan] = await app.db
      .insert(schema.shopifyPlans)
      .values({ name: 'Concurrent', priceCents: 999, includedTryons: 20, overageCents: 16 })
      .returning();
    const chargeId = 77777;

    await Promise.all([
      activateCharge(app, store.id, plan.id, chargeId),
      activateCharge(app, store.id, plan.id, chargeId),
    ]);

    const [updated] = await app.db
      .select()
      .from(schema.shopifyStores)
      .where(eq(schema.shopifyStores.id, store.id));
    expect(updated.billingPlanId).toBe(chargeId);
    expect(updated.shopifyPlanId).toBe(plan.id);
  });
});
