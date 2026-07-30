import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { and, eq } from 'drizzle-orm';
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
    {
      storeId,
      shopifyProductId: 3,
      shopifyVariantId: null,
      r2Key: `shopify-garments/${storeId}/3/garment.jpg`,
      status: 'deleted',
      enabled: true,
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
  it('includes totalTryOns, syncedProductCount, enabledProductCount, statusCounts', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/shopify/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.stats).toEqual({
      totalTryOns: 3,
      syncedProductCount: 3,
      enabledProductCount: 1,
      funnelConfigured: false,
      // Deleted rows are excluded — 3 synced, 2 of them still tryable, neither mapped.
      funnelCounts: { mapped: 0, unmapped: 2, byRule: 0, byHand: 0 },
      statusCounts: { active: 1, processing: 0, failed: 0, disabled: 2 },
    });
  });
});

describe('GET /v1/shopify/me stats.funnelCounts', () => {
  it('counts mapped/unmapped products, not just whether any mapping exists', async () => {
    let res = await app.inject({
      method: 'GET',
      url: '/v1/shopify/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.json().stats.funnelConfigured).toBe(false);
    expect(res.json().stats.funnelCounts).toEqual({
      mapped: 0,
      unmapped: 2,
      byRule: 0,
      byHand: 0,
    });

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
    expect(res.json().stats.funnelCounts).toEqual({
      mapped: 2,
      unmapped: 0,
      byRule: 0,
      byHand: 2,
    });
  });

  it('reports a partially mapped store as partial, where funnelConfigured says "true"', async () => {
    // The exact shape of the production incident: one product left unmapped among
    // many mapped ones. The old boolean reported this store as fully configured.
    await app.db
      .update(schema.shopifyProductGarments)
      .set({ funnelTemplateId: null, funnelAssignmentSource: null })
      .where(
        and(
          eq(schema.shopifyProductGarments.storeId, storeId),
          eq(schema.shopifyProductGarments.shopifyProductId, 2),
        ),
      );

    const res = await app.inject({
      method: 'GET',
      url: '/v1/shopify/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.json().stats.funnelConfigured).toBe(true);
    expect(res.json().stats.funnelCounts).toEqual({
      mapped: 1,
      unmapped: 1,
      byRule: 0,
      byHand: 1,
    });
  });
});

describe('GET /v1/shopify/me ownerUserId + creditBalance', () => {
  it('is unlinked by default: ownerUserId null, creditBalance null', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/shopify/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.json().store.ownerUserId).toBeNull();
    expect(res.json().creditBalance).toBeNull();
  });

  it("reflects the linked user's credit balance once ownerUserId is set", async () => {
    const [user] = await app.db
      .insert(schema.users)
      .values({ email: `me-owner-${randomUUID()}@test.com`, displayName: 'Owner' })
      .returning();
    await app.db.insert(schema.userCredits).values({ userId: user.id, balance: 42 });
    await app.db
      .update(schema.shopifyStores)
      .set({ ownerUserId: user.id })
      .where(eq(schema.shopifyStores.id, storeId));

    const res = await app.inject({
      method: 'GET',
      url: '/v1/shopify/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.json().store.ownerUserId).toBe(user.id);
    expect(res.json().creditBalance).toBe(42);
  });
});

describe('GET /v1/shopify/me store.connectedSince', () => {
  it("reflects the store's installedAt timestamp", async () => {
    const [store] = await app.db
      .select({ installedAt: schema.shopifyStores.installedAt })
      .from(schema.shopifyStores)
      .where(eq(schema.shopifyStores.id, storeId));

    const res = await app.inject({
      method: 'GET',
      url: '/v1/shopify/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.json().store.connectedSince).toBe(store.installedAt.toISOString());
  });
});
