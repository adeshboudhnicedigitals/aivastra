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
let widgetClientId: string;
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
  widgetClientId = store.widgetClientId;
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
  it('seeds credits = includedTryons * SHOPIFY_JOB_COST', async () => {
    await activateCharge(app, storeId, planId, 55555 /* shopify charge id */);
    const [store] = await app.db
      .select()
      .from(schema.shopifyStores)
      .where(eq(schema.shopifyStores.id, storeId));
    expect(store.shopifyPlanId).toBe(planId);
    expect(store.billingPlanId).toBe(55555);
    const [credits] = await app.db
      .select()
      .from(schema.widgetClientCredits)
      .where(eq(schema.widgetClientCredits.widgetClientId, widgetClientId));
    expect(credits.balance).toBe(1000); // 100 * 10
  });
});
