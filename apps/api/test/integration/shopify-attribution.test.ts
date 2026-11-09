import { schema } from '@aivastra/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analyticsCards } from '../../src/modules/shopify/analytics.js';
import { attributeOrder, lineValueByProduct } from '../../src/modules/shopify/attribution.js';
import { upsertShopifyStore } from '../../src/modules/shopify/auth.routes.js';
import { buildTestApp } from '../helpers/api.js';
import { startContainers } from '../helpers/containers.js';

const DAY = 86_400_000;

describe('shopify order attribution', () => {
  let ctx: Awaited<ReturnType<typeof startContainers>>;
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  let storeId: string;
  const now = new Date();

  async function tryOn(
    shopperId: string,
    productId: number,
    ageDays: number,
    status = 'COMPLETED',
  ) {
    const [job] = await app.db
      .insert(schema.jobs)
      .values({
        shopifyStoreId: storeId,
        shopifyShopperId: shopperId,
        status,
        createdAt: new Date(now.getTime() - ageDays * DAY),
      })
      .returning({ id: schema.jobs.id });
    if (!job) throw new Error('job insert failed');
    await app.db.insert(schema.jobInputs).values({
      jobId: job.id,
      upperGarmentKey: 'k',
      params: { kind: 'shopify', shopifyProductId: productId },
    });
  }

  beforeAll(async () => {
    ctx = await startContainers();
    app = await buildTestApp(ctx, {
      SHOPIFY_TOKEN_ENC_KEY: Buffer.alloc(32, 11).toString('base64'),
    });
    const store = await upsertShopifyStore(
      app,
      {
        shopifyShopId: 88,
        shopDomain: 'attr.myshopify.com',
        myshopifyDomain: 'attr.myshopify.com',
        name: 'A',
        email: 'a@a.com',
      },
      'tok',
      'read_products',
    );
    storeId = store.id;
  });
  afterAll(async () => {
    await app.close();
    await ctx.stop();
  });

  it('nets line discounts and ignores lines without a product', () => {
    const m = lineValueByProduct([
      { product_id: 1, price: '10.00', quantity: 2, total_discount: '5.00' },
      { product_id: 1, price: '1.50', quantity: 1 },
      { product_id: null, price: '99.00', quantity: 1 },
    ]);
    expect([...m]).toEqual([[1, 1650]]);
  });

  it('credits only the tried-on product, once, and surfaces it in the analytics card', async () => {
    const [shopper] = await app.db
      .insert(schema.shopifyShoppers)
      .values({ storeId, clientId: 'c1', email: 'buyer@x.com', shopifyCustomerId: 555 })
      .returning({ id: schema.shopifyShoppers.id });
    if (!shopper) throw new Error('shopper insert failed');
    await tryOn(shopper.id, 100, 2);
    await tryOn(shopper.id, 300, 20); // outside the window
    await tryOn(shopper.id, 400, 1, 'FAILED'); // never produced a result

    const order = {
      id: 9001,
      processed_at: now.toISOString(),
      currency: 'INR',
      customer: { id: 555 },
      line_items: [
        { product_id: 100, price: '1000.00', quantity: 1, total_discount: '100.00' },
        { product_id: 200, price: '500.00', quantity: 1 }, // never tried on
        { product_id: 300, price: '700.00', quantity: 1 },
        { product_id: 400, price: '800.00', quantity: 1 },
      ],
    };
    expect(await attributeOrder(app.db, storeId, order)).toBe(true);
    expect(await attributeOrder(app.db, storeId, order)).toBe(false); // redelivery

    const cards = await analyticsCards(app.db, storeId, {
      from: new Date(now.getTime() - 30 * DAY),
      to: new Date(now.getTime() + DAY),
      timezone: 'UTC',
    });
    expect(cards.revenue).toEqual([{ currency: 'INR', amount: 900, orders: 1 }]);
  });

  it('matches by email when the order has no customer id, and skips strangers', async () => {
    expect(
      await attributeOrder(app.db, storeId, {
        id: 9002,
        processed_at: now.toISOString(),
        currency: 'INR',
        email: 'BUYER@x.com',
        line_items: [{ product_id: 100, price: '50.00', quantity: 1 }],
      }),
    ).toBe(true);
    expect(
      await attributeOrder(app.db, storeId, {
        id: 9003,
        processed_at: now.toISOString(),
        currency: 'INR',
        email: 'stranger@x.com',
        line_items: [{ product_id: 100, price: '50.00', quantity: 1 }],
      }),
    ).toBe(false);
  });
});
