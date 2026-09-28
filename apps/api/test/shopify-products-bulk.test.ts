import { schema } from '@aivastra/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { upsertShopifyStore } from '../src/modules/shopify/auth.routes.js';
import { buildTestApp, type TestApp } from './helpers/api.js';
import { type Containers, startContainers } from './helpers/containers.js';
import { signSessionToken } from './helpers/shopify-session.js';

const ENC_KEY = Buffer.alloc(32, 14).toString('base64');
const API_SECRET = 'test-secret';
const API_KEY = 'test-key';

let c: Containers;
let app: TestApp;
let storeId: string;
let otherStoreId: string;
let auth: { authorization: string };
let basketId: string;
let inactiveBasketId: string;

async function seedBasket(active: boolean): Promise<string> {
  const tag = `${Date.now()}-${Math.random()}`;
  const [workflow] = await app.db
    .insert(schema.workflowTemplates)
    .values({
      slug: `bulk-wf-${tag}`,
      label: 'Bulk test workflow',
      jsonContent: {},
      poseNodeId: '2',
      upperNodeIds: ['4'],
      garmentPhasePromptNode: '6',
      workflowType: 'tryon',
      tryonPersonNodeId: '10',
      tryonGarmentNodeId: '11',
      tryonOutputNodeId: '12',
    })
    .returning();
  const [basket] = await app.db
    .insert(schema.shopifyFunnelTemplates)
    .values({
      slug: `bulk-basket-${tag}`,
      label: 'Bulk basket',
      workflowTemplateId: workflow.id,
      isActive: active,
    })
    .returning();
  return basket.id;
}

async function seed(
  forStoreId: string,
  id: number,
  fields: Partial<typeof schema.shopifyProductGarments.$inferInsert> = {},
) {
  await app.db.insert(schema.shopifyProductGarments).values({
    storeId: forStoreId,
    shopifyProductId: id,
    r2Key: `shopify-garments/${forStoreId}/${id}/garment.jpg`,
    title: `Product ${id}`,
    status: 'active',
    ...fields,
  });
}

async function row(forStoreId: string, id: number) {
  const [r] = await app.db
    .select()
    .from(schema.shopifyProductGarments)
    .where(
      and(
        eq(schema.shopifyProductGarments.storeId, forStoreId),
        eq(schema.shopifyProductGarments.shopifyProductId, id),
      ),
    );
  return r;
}

async function bulk(payload: unknown, headers = auth) {
  return app.inject({ method: 'POST', url: '/v1/shopify/products/bulk', headers, payload });
}

beforeAll(async () => {
  c = await startContainers();
  app = await buildTestApp(c, {
    SHOPIFY_TOKEN_ENC_KEY: ENC_KEY,
    SHOPIFY_API_SECRET: API_SECRET,
    SHOPIFY_API_KEY: API_KEY,
  });
  const mine = await upsertShopifyStore(
    app,
    {
      shopifyShopId: 1401,
      shopDomain: 'bulk-a.myshopify.com',
      myshopifyDomain: 'bulk-a.myshopify.com',
      name: 'A',
      email: 'a@bulk.com',
    },
    'tok',
    'read_products',
  );
  const other = await upsertShopifyStore(
    app,
    {
      shopifyShopId: 1402,
      shopDomain: 'bulk-b.myshopify.com',
      myshopifyDomain: 'bulk-b.myshopify.com',
      name: 'B',
      email: 'b@bulk.com',
    },
    'tok',
    'read_products',
  );
  storeId = mine.id;
  otherStoreId = other.id;
  auth = {
    authorization: `Bearer ${signSessionToken('bulk-a.myshopify.com', API_SECRET, API_KEY)}`,
  };
  basketId = await seedBasket(true);
  inactiveBasketId = await seedBasket(false);
});

// Fresh rows per test so no test depends on another's writes.
beforeEach(async () => {
  await app.db
    .delete(schema.shopifyProductGarments)
    .where(eq(schema.shopifyProductGarments.storeId, storeId));
  await app.db
    .delete(schema.shopifyProductGarments)
    .where(eq(schema.shopifyProductGarments.storeId, otherStoreId));
  await seed(storeId, 1, { productType: 'Saree' });
  await seed(storeId, 2, { productType: 'Saree' });
  await seed(storeId, 3, { productType: 'Kurta' });
  await seed(storeId, 4, { status: 'processing' });
  await seed(storeId, 5, { excluded: true });
  await seed(otherStoreId, 1, { productType: 'Saree' });
});

afterAll(async () => {
  await app?.close();
  await c?.stop();
});

describe('POST /v1/shopify/products/bulk — enabling', () => {
  it('enables the listed active, non-excluded products and counts the skipped ones', async () => {
    const res = await bulk({ target: { ids: [1, 2, 4, 5] }, enabled: true });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ updated: 2, skipped: { notActive: 1, excluded: 1 } });
    expect((await row(storeId, 1)).enabled).toBe(true);
    expect((await row(storeId, 2)).enabled).toBe(true);
    expect((await row(storeId, 4)).enabled).toBe(false);
    expect((await row(storeId, 5)).enabled).toBe(false);
    expect((await row(storeId, 3)).enabled).toBe(false);
  });

  it('enables everything a filter matches', async () => {
    const res = await bulk({
      target: { filter: { productType: ['Saree'] } },
      enabled: true,
    });
    expect(res.json()).toEqual({ updated: 2, skipped: { notActive: 0, excluded: 0 } });
    expect((await row(storeId, 3)).enabled).toBe(false);
  });

  it('honours excludeIds with a filter target ("select all, except these")', async () => {
    const res = await bulk({
      target: { filter: { productType: ['Saree'] }, excludeIds: [2] },
      enabled: true,
    });
    expect(res.json().updated).toBe(1);
    expect((await row(storeId, 1)).enabled).toBe(true);
    expect((await row(storeId, 2)).enabled).toBe(false);
  });

  it("never touches another store's products, by id or by filter", async () => {
    const byId = await bulk({ target: { ids: [1] }, enabled: true });
    expect(byId.json().updated).toBe(1); // only this store's product 1
    expect((await row(otherStoreId, 1)).enabled).toBe(false);

    const byFilter = await bulk({ target: { filter: {} }, enabled: true });
    expect(byFilter.statusCode).toBe(200);
    expect((await row(otherStoreId, 1)).enabled).toBe(false);
  });

  it('is idempotent — repeating a call leaves the same end state', async () => {
    await bulk({ target: { ids: [1] }, enabled: true });
    const again = await bulk({ target: { ids: [1] }, enabled: true });
    expect(again.statusCode).toBe(200);
    expect((await row(storeId, 1)).enabled).toBe(true);
  });
});

describe('POST /v1/shopify/products/bulk — baskets', () => {
  it('pins the target products to a basket and records the source as manual', async () => {
    const res = await bulk({ target: { ids: [1, 2] }, funnelTemplateId: basketId });
    expect(res.json().updated).toBe(2);
    const r = await row(storeId, 1);
    expect(r.funnelTemplateId).toBe(basketId);
    expect(r.funnelAssignmentSource).toBe('manual');
    expect((await row(storeId, 3)).funnelTemplateId).toBeNull();
  });

  it('enables and pins in one call', async () => {
    await bulk({ target: { ids: [1] }, enabled: true, funnelTemplateId: basketId });
    const r = await row(storeId, 1);
    expect(r.enabled).toBe(true);
    expect(r.funnelTemplateId).toBe(basketId);
  });

  it('clears a pin and its source with null', async () => {
    await bulk({ target: { ids: [1] }, funnelTemplateId: basketId });
    await bulk({ target: { ids: [1] }, funnelTemplateId: null });
    const r = await row(storeId, 1);
    expect(r.funnelTemplateId).toBeNull();
    expect(r.funnelAssignmentSource).toBeNull();
  });

  it('rejects an inactive or unknown basket with 404 and changes nothing', async () => {
    const inactive = await bulk({
      target: { ids: [1] },
      enabled: true,
      funnelTemplateId: inactiveBasketId,
    });
    expect(inactive.statusCode).toBe(404);
    const unknown = await bulk({
      target: { ids: [1] },
      funnelTemplateId: '00000000-0000-4000-8000-000000000000',
    });
    expect(unknown.statusCode).toBe(404);
    const r = await row(storeId, 1);
    expect(r.enabled).toBe(false);
    expect(r.funnelTemplateId).toBeNull();
  });
});

describe('POST /v1/shopify/products/bulk — validation', () => {
  it('requires enabled or funnelTemplateId', async () => {
    expect((await bulk({ target: { ids: [1] } })).statusCode).toBe(400);
  });

  it('rejects an empty ids list', async () => {
    expect((await bulk({ target: { ids: [] }, enabled: true })).statusCode).toBe(400);
  });

  it('rejects enabled: false — the wizard only ever enables', async () => {
    expect((await bulk({ target: { ids: [1] }, enabled: false })).statusCode).toBe(400);
  });

  it('requires a Shopify session', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/shopify/products/bulk',
      payload: { target: { ids: [1] }, enabled: true },
    });
    expect(res.statusCode).toBe(401);
  });
});
