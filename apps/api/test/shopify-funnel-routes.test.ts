import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
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
