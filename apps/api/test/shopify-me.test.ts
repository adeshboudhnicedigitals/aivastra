import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { upsertShopifyStore } from '../src/modules/shopify/auth.routes.js';
import { buildTestApp, type TestApp } from './helpers/api.js';
import { type Containers, startContainers } from './helpers/containers.js';
import { signSessionToken } from './helpers/shopify-session.js';

const ENC_KEY = Buffer.alloc(32, 11).toString('base64');
const API_SECRET = 'test-secret';
const API_KEY = 'test-key';
let c: Containers;
let app: TestApp;
let storeId: string;
let token: string;

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
      shopifyShopId: 66,
      shopDomain: 'm.myshopify.com',
      myshopifyDomain: 'm.myshopify.com',
      name: 'M',
      email: 'm@m.com',
    },
    'tok',
    'read_products',
  );
  storeId = store.id;
  token = signSessionToken('m.myshopify.com', API_SECRET, API_KEY);

  await app.db.insert(schema.shopifyProductGarments).values([
    {
      storeId,
      shopifyProductId: 1,
      shopifyVariantId: null,
      r2Key: `shopify-garments/${storeId}/1/garment.jpg`,
      status: 'active',
      enabled: true,
    },
    {
      storeId,
      shopifyProductId: 2,
      shopifyVariantId: null,
      r2Key: `shopify-garments/${storeId}/2/garment.jpg`,
      status: 'processing',
      enabled: false,
    },
  ]);

  for (let i = 0; i < 3; i++) {
    // biome-ignore lint/suspicious/noExplicitAny: Drizzle infers userId as non-null; widget jobs legitimately have null userId
    await (app.db.insert(schema.jobs).values as any)({
      id: randomUUID(),
      userId: null,
      shopifyStoreId: storeId,
      status: 'COMPLETED',
      creditsCharged: 10,
    });
  }
});
afterAll(async () => {
  await app?.close();
  await c?.stop();
});

describe('GET /v1/shopify/me stats', () => {
  it('includes totalTryOns, syncedProductCount, enabledProductCount', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/shopify/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.stats).toEqual({
      totalTryOns: 3,
      syncedProductCount: 2,
      enabledProductCount: 1,
      funnelConfigured: false,
    });
  });
});

describe('GET /v1/shopify/me stats.funnelConfigured', () => {
  it('is false with no funnel assignment, true once one exists', async () => {
    let res = await app.inject({
      method: 'GET',
      url: '/v1/shopify/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.json().stats.funnelConfigured).toBe(false);

    const [wf] = await app.db
      .insert(schema.workflowTemplates)
      .values({
        slug: 'me-stat-wf',
        label: 'Me Stat WF',
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
      .values({ slug: 'me-stat-test', label: 'Me Stat Test', workflowTemplateId: wf.id })
      .returning();
    await app.db
      .update(schema.shopifyProductGarments)
      .set({ funnelTemplateId: template.id, funnelAssignmentSource: 'manual' })
      .where(eq(schema.shopifyProductGarments.storeId, storeId));

    res = await app.inject({
      method: 'GET',
      url: '/v1/shopify/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.json().stats.funnelConfigured).toBe(true);
  });
});
