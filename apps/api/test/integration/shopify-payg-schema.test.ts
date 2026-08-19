import { schema } from '@aivastra/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

describe('shopify PAYG schema', () => {
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

  it('defaults a new store to prepaid billing mode with no spend cap', async () => {
    const [store] = await app.db
      .insert(schema.shopifyStores)
      .values({
        shopDomain: `payg-schema-${Date.now()}.myshopify.com`,
        shopifyShopId: Date.now(),
        accessToken: 'enc',
        scope: 'read_products',
      })
      .returning();
    expect(store?.billingMode).toBe('prepaid');
    expect(store?.paygSpendCapUsdCents).toBeNull();
    expect(store?.subscriptionIsTest).toBe(false);
  });

  it('enforces one usage_events row per job via the unique constraint', async () => {
    const [store] = await app.db
      .insert(schema.shopifyStores)
      .values({
        shopDomain: `payg-schema-2-${Date.now()}.myshopify.com`,
        shopifyShopId: Date.now() + 1,
        accessToken: 'enc',
        scope: 'read_products',
        billingMode: 'usage',
      })
      .returning();
    const [job] = await (app.db.insert(schema.jobs).values as never)({
      shopifyStoreId: store?.id,
      customerPhotoKey: 'x',
      status: 'QUEUED',
      creditsCharged: 0,
    }).returning();

    await app.db.insert(schema.shopifyUsageEvents).values({
      storeId: store?.id as string,
      jobId: job?.id as string,
      priceUsdCents: 10,
    });

    await expect(
      app.db.insert(schema.shopifyUsageEvents).values({
        storeId: store?.id as string,
        jobId: job?.id as string,
        priceUsdCents: 10,
      }),
    ).rejects.toThrow();
  });
});
