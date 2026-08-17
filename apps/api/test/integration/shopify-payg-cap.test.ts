import { schema } from '@aivastra/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkPaygSpendCap, getPaygSpendThisCycleCents } from '../../src/modules/shopify/payg.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

describe('PAYG spend cap', () => {
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

  async function seedStore(overrides: Partial<typeof schema.shopifyStores.$inferInsert> = {}) {
    const stores = await app.db
      .insert(schema.shopifyStores)
      .values({
        shopDomain: `payg-cap-${Date.now()}-${Math.random()}.myshopify.com`,
        shopifyShopId: Date.now() + Math.floor(Math.random() * 100000),
        accessToken: 'enc',
        scope: 'read_products',
        billingMode: 'usage',
        subscriptionStatus: 'active',
        paygSpendCapUsdCents: 100, // $1.00 = 10 try-ons at $0.10 each
        ...overrides,
      })
      .returning();
    return stores[0] as typeof schema.shopifyStores.$inferSelect;
  }

  async function seedUsageRow(storeId: string, priceUsdCents: number, createdAt?: Date) {
    const [job] = await (app.db.insert(schema.jobs).values as never)({
      shopifyStoreId: storeId,
      customerPhotoKey: 'x',
      status: 'COMPLETED',
      creditsCharged: 0,
    }).returning();
    await app.db.insert(schema.shopifyUsageEvents).values({
      storeId,
      jobId: job?.id as string,
      priceUsdCents,
      createdAt,
    });
  }

  it('allows dispatch when under the cap', async () => {
    const store = await seedStore();
    await seedUsageRow(store.id, 50);
    await expect(checkPaygSpendCap(app, store)).resolves.not.toThrow();
  });

  it('rejects dispatch at or over the cap', async () => {
    const store = await seedStore();
    await seedUsageRow(store.id, 60);
    await seedUsageRow(store.id, 40); // exactly at the $1.00 cap
    await expect(checkPaygSpendCap(app, store)).rejects.toMatchObject({
      code: 'PAYG_CAP_REACHED',
    });
  });

  it('excludes usage from before the current billing cycle', async () => {
    const store = await seedStore({ currentPeriodEnd: new Date(Date.now() + 86400000) });
    const lastCycle = new Date(Date.now() - 40 * 86400000);
    await seedUsageRow(store.id, 90, lastCycle);
    const spend = await getPaygSpendThisCycleCents(app, store);
    expect(spend).toBe(0);
  });

  it('rejects dispatch when the subscription is not active, even well under the spend cap', async () => {
    // billingMode is set to 'usage' purely from the plan name match — a
    // PENDING subscription (merchant never approved the charge) still
    // leaves billingMode as 'usage'. Without this gate the store could
    // generate try-ons up to the cap for free, indefinitely.
    const store = await seedStore({ subscriptionStatus: 'pending' });
    await expect(checkPaygSpendCap(app, store)).rejects.toMatchObject({
      code: 'SUBSCRIPTION_INACTIVE',
    });
  });
});
