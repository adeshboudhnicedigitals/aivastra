import { schema } from '@aivastra/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { upsertShopifyStore } from '../src/modules/shopify/auth.routes.js';
import { buildTestApp, type TestApp } from './helpers/api.js';
import { type Containers, startContainers } from './helpers/containers.js';
import { signSessionToken } from './helpers/shopify-session.js';

const ENC_KEY = Buffer.alloc(32, 21).toString('base64');
const API_SECRET = 'test-secret';
const API_KEY = 'test-key';
let c: Containers;
let app: TestApp;
let storeId: string;
let token: string;
let funnelTemplateId: string;

beforeAll(async () => {
  c = await startContainers();
  app = await buildTestApp(c, {
    SHOPIFY_TOKEN_ENC_KEY: ENC_KEY,
    SHOPIFY_API_SECRET: API_SECRET,
    SHOPIFY_API_KEY: API_KEY,
  });
  const store = await upsertShopifyStore(
    app,
    {
      shopifyShopId: 501,
      shopDomain: 'funnel-test.myshopify.com',
      myshopifyDomain: 'funnel-test.myshopify.com',
      name: 'F',
      email: 'f@f.com',
    },
    'tok',
    'read_products',
  );
  storeId = store.id;
  token = signSessionToken('funnel-test.myshopify.com', API_SECRET, API_KEY);

  const [wf] = await app.db
    .insert(schema.workflowTemplates)
    .values({
      slug: 'funnel-route-wf',
      label: 'Funnel Route WF',
      jsonContent: {},
      faceNodeId: 'x',
      poseNodeId: 'x',
      bgNodeId: 'x',
      upperNodeIds: [],
      facePhasePromptNode: 'x',
      garmentPhasePromptNode: 'x',
      workflowType: 'tryon',
    })
    .returning();
  const [template] = await app.db
    .insert(schema.shopifyFunnelTemplates)
    .values({ slug: 'funnel-route-test', label: 'Test Funnel', workflowTemplateId: wf.id })
    .returning();
  funnelTemplateId = template.id;
});
afterAll(async () => {
  await app?.close();
  await c?.stop();
});

describe('GET /v1/shopify/funnel-templates', () => {
  it('lists active templates with a defaulted manual rule when none is saved', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/shopify/funnel-templates',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const item = body.items.find((i: { id: string }) => i.id === funnelTemplateId);
    expect(item.label).toBe('Test Funnel');
    expect(item.rule).toEqual({ mode: 'manual', conditions: [], priority: 0 });
  });
});

describe('PATCH /v1/shopify/funnel-templates/:id/rule', () => {
  it('upserts the store rule for a funnel template', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/shopify/funnel-templates/${funnelTemplateId}/rule`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        mode: 'automated',
        conditions: [{ field: 'product_type', operator: 'equals', value: 'Shirts' }],
        priority: 5,
      },
    });
    expect(res.statusCode).toBe(200);

    const [row] = await app.db
      .select()
      .from(schema.shopifyFunnelRules)
      .where(eq(schema.shopifyFunnelRules.storeId, storeId));
    expect(row.mode).toBe('automated');
    expect(row.priority).toBe(5);
    expect(row.conditions).toEqual([
      { field: 'product_type', operator: 'equals', value: 'Shirts' },
    ]);
  });
});

describe('PATCH /v1/shopify/products/:id/funnel', () => {
  it('manually assigns a product to a funnel template', async () => {
    await app.db.insert(schema.shopifyProductGarments).values({
      storeId,
      shopifyProductId: 9001,
      shopifyVariantId: 0,
      r2Key: 'shopify-garments/test/9001/garment.jpg',
      status: 'active',
    });

    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/shopify/products/9001/funnel',
      headers: { authorization: `Bearer ${token}` },
      payload: { funnelTemplateId },
    });
    expect(res.statusCode).toBe(200);

    const [row] = await app.db
      .select()
      .from(schema.shopifyProductGarments)
      .where(
        and(
          eq(schema.shopifyProductGarments.storeId, storeId),
          eq(schema.shopifyProductGarments.shopifyProductId, 9001),
        ),
      );
    expect(row.funnelTemplateId).toBe(funnelTemplateId);
    expect(row.funnelAssignmentSource).toBe('manual');
  });

  it('clearing to null resets to automated and re-evaluates immediately', async () => {
    await app.db
      .insert(schema.shopifyFunnelRules)
      .values({
        storeId,
        funnelTemplateId,
        mode: 'automated',
        conditions: [{ field: 'vendor', operator: 'equals', value: 'ClearTest' }],
        priority: 0,
      })
      .onConflictDoUpdate({
        target: [schema.shopifyFunnelRules.storeId, schema.shopifyFunnelRules.funnelTemplateId],
        set: {
          mode: 'automated',
          conditions: [{ field: 'vendor', operator: 'equals', value: 'ClearTest' }],
        },
      });
    await app.db.insert(schema.shopifyProductGarments).values({
      storeId,
      shopifyProductId: 9002,
      shopifyVariantId: 0,
      r2Key: 'shopify-garments/test/9002/garment.jpg',
      status: 'active',
      vendor: 'ClearTest',
      funnelTemplateId,
      funnelAssignmentSource: 'manual',
    });

    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/shopify/products/9002/funnel',
      headers: { authorization: `Bearer ${token}` },
      payload: { funnelTemplateId: null },
    });
    expect(res.statusCode).toBe(200);

    const [row] = await app.db
      .select()
      .from(schema.shopifyProductGarments)
      .where(
        and(
          eq(schema.shopifyProductGarments.storeId, storeId),
          eq(schema.shopifyProductGarments.shopifyProductId, 9002),
        ),
      );
    expect(row.funnelAssignmentSource).toBe('automated');
    expect(row.funnelTemplateId).toBe(funnelTemplateId);
  });
});

describe('POST /v1/shopify/funnel-templates/re-run', () => {
  it('re-evaluates non-manual products, skips manual ones', async () => {
    await app.db
      .insert(schema.shopifyFunnelRules)
      .values({
        storeId,
        funnelTemplateId,
        mode: 'automated',
        conditions: [{ field: 'vendor', operator: 'equals', value: 'RerunTest' }],
        priority: 0,
      })
      .onConflictDoUpdate({
        target: [schema.shopifyFunnelRules.storeId, schema.shopifyFunnelRules.funnelTemplateId],
        set: {
          mode: 'automated',
          conditions: [{ field: 'vendor', operator: 'equals', value: 'RerunTest' }],
        },
      });
    await app.db.insert(schema.shopifyProductGarments).values([
      {
        storeId,
        shopifyProductId: 9003,
        shopifyVariantId: 0,
        r2Key: 'x',
        status: 'active',
        vendor: 'RerunTest',
      },
      {
        storeId,
        shopifyProductId: 9004,
        shopifyVariantId: 0,
        r2Key: 'y',
        status: 'active',
        vendor: 'RerunTest',
        funnelTemplateId: null,
        funnelAssignmentSource: 'manual',
      },
    ]);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/shopify/funnel-templates/re-run',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);

    const rows = await app.db
      .select()
      .from(schema.shopifyProductGarments)
      .where(
        and(
          eq(schema.shopifyProductGarments.storeId, storeId),
          eq(schema.shopifyProductGarments.vendor, 'RerunTest'),
        ),
      );
    const auto = rows.find((r) => r.shopifyProductId === 9003);
    const manual = rows.find((r) => r.shopifyProductId === 9004);
    expect(auto?.funnelTemplateId).toBe(funnelTemplateId);
    expect(auto?.funnelAssignmentSource).toBe('automated');
    expect(manual?.funnelTemplateId).toBeNull();
    expect(manual?.funnelAssignmentSource).toBe('manual');
  });
});
