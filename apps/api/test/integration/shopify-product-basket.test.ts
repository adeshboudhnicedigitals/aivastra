import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { upsertShopifyStore } from '../../src/modules/shopify/auth.routes.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';
import { signSessionToken } from '../helpers/shopify-session.js';

const ENC_KEY = Buffer.alloc(32, 12).toString('base64');
const API_SECRET = 'test-secret';
const API_KEY = 'test-key';

describe('shopify product basket reporting and pinning', () => {
  let c: Containers;
  let app: TestApp;

  let auth: { authorization: string };
  let sareeBasketId: string;
  let upperBasketId: string;
  let sareeProductId: number;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c, {
      SHOPIFY_TOKEN_ENC_KEY: ENC_KEY,
      SHOPIFY_API_SECRET: API_SECRET,
      SHOPIFY_API_KEY: API_KEY,
    });

    const tag = Date.now();

    async function seedWorkflow(slug: string) {
      const [wf] = await app.db
        .insert(schema.workflowTemplates)
        .values({
          slug,
          label: slug,
          jsonContent: {},
          poseNodeId: '2',
          upperNodeIds: ['4'],
          garmentPhasePromptNode: '6',
          workflowType: 'tryon',
          tryonPersonNodeId: '10',
          tryonGarmentNodeId: '11',
          tryonOutputNodeId: '12',
          version: 1,
        })
        .returning();
      return wf.id;
    }

    async function seedBasket(slug: string, label: string, workflowTemplateId: string) {
      const [basket] = await app.db
        .insert(schema.shopifyFunnelTemplates)
        .values({ slug, label, workflowTemplateId })
        .returning();
      return basket.id;
    }

    sareeBasketId = await seedBasket(
      `product-basket-saree-${tag}`,
      'Saree',
      await seedWorkflow(`product-basket-saree-wf-${tag}`),
    );
    upperBasketId = await seedBasket(
      `product-basket-upper-${tag}`,
      'Upper',
      await seedWorkflow(`product-basket-upper-wf-${tag}`),
    );

    // Global rule: any product tagged "saree" routes to the saree basket.
    await app.db.insert(schema.shopifyFunnelRules).values({
      storeId: null,
      funnelTemplateId: sareeBasketId,
      conditions: [{ field: 'tags', operator: 'contains', value: 'saree' }],
      priority: 10,
    });

    const store = await upsertShopifyStore(
      app,
      {
        shopifyShopId: tag,
        shopDomain: `product-basket-${tag}.myshopify.com`,
        myshopifyDomain: `product-basket-${tag}.myshopify.com`,
        name: 'Product Basket Store',
        email: 'store@product-basket.com',
      },
      'tok',
      'read_products',
    );
    auth = {
      authorization: `Bearer ${signSessionToken(store.shopDomain, API_SECRET, API_KEY)}`,
    };

    sareeProductId = tag + 1;
    await app.db.insert(schema.shopifyProductGarments).values({
      storeId: store.id,
      shopifyProductId: sareeProductId,
      r2Key: `shopify-garments/${store.id}/${sareeProductId}/garment.jpg`,
      title: 'Saree Product',
      status: 'active',
      enabled: true,
      tags: ['saree'],
    });
  });

  afterAll(async () => {
    await app.close();
    await c.stop();
  });

  it('reports the rule-derived basket and its source', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/shopify/products', headers: auth });
    const item = res
      .json()
      .items.find((i: { shopifyProductId: number }) => i.shopifyProductId === sareeProductId);
    expect(item.basket).toEqual({ id: sareeBasketId, label: 'Saree', source: 'rule' });
  });

  it('pins a product and reports source manual', async () => {
    await app.inject({
      method: 'PATCH',
      url: `/v1/shopify/products/${sareeProductId}`,
      headers: auth,
      payload: { funnelTemplateId: upperBasketId },
    });
    const [row] = await app.db
      .select()
      .from(schema.shopifyProductGarments)
      .where(eq(schema.shopifyProductGarments.shopifyProductId, sareeProductId));
    expect(row.funnelTemplateId).toBe(upperBasketId);
    expect(row.funnelAssignmentSource).toBe('manual');

    const res = await app.inject({ method: 'GET', url: '/v1/shopify/products', headers: auth });
    const item = res
      .json()
      .items.find((i: { shopifyProductId: number }) => i.shopifyProductId === sareeProductId);
    expect(item.basket).toEqual({ id: upperBasketId, label: 'Upper', source: 'manual' });
  });

  it('clears the pin on null and reverts to rule routing', async () => {
    await app.inject({
      method: 'PATCH',
      url: `/v1/shopify/products/${sareeProductId}`,
      headers: auth,
      payload: { funnelTemplateId: null },
    });
    const [row] = await app.db
      .select()
      .from(schema.shopifyProductGarments)
      .where(eq(schema.shopifyProductGarments.shopifyProductId, sareeProductId));
    expect(row.funnelTemplateId).toBeNull();
    expect(row.funnelAssignmentSource).toBeNull();

    const res = await app.inject({ method: 'GET', url: '/v1/shopify/products', headers: auth });
    const item = res
      .json()
      .items.find((i: { shopifyProductId: number }) => i.shopifyProductId === sareeProductId);
    expect(item.basket.source).toBe('rule');
  });

  it('rejects a pin to an unknown basket', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/shopify/products/${sareeProductId}`,
      headers: auth,
      payload: { funnelTemplateId: '00000000-0000-0000-0000-000000000000' },
    });
    expect(res.statusCode).toBe(404);
  });
});
