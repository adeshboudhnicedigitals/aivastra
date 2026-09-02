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

describe('shopify merchant funnel rules routes', () => {
  let c: Containers;
  let app: TestApp;

  let authA: { authorization: string };
  let authB: { authorization: string };
  let storeAId: string;
  let storeBId: string;
  let upperBasketId: string;
  let defaultBasketId: string;
  let globalRuleId: string;
  let storeARuleId: string;
  let storeBRuleId: string;

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

    async function seedBasket(slug: string, workflowTemplateId: string, isDefault = false) {
      const [basket] = await app.db
        .insert(schema.shopifyFunnelTemplates)
        .values({ slug, label: slug, workflowTemplateId, isDefault })
        .returning();
      return basket.id;
    }

    upperBasketId = await seedBasket(
      `merchant-rules-upper-${tag}`,
      await seedWorkflow(`merchant-rules-upper-wf-${tag}`),
    );
    defaultBasketId = await seedBasket(
      `merchant-rules-default-${tag}`,
      await seedWorkflow(`merchant-rules-default-wf-${tag}`),
      true,
    );
    const globalBasketId = await seedBasket(
      `merchant-rules-global-${tag}`,
      await seedWorkflow(`merchant-rules-global-wf-${tag}`),
    );
    const storeABasketId = await seedBasket(
      `merchant-rules-store-a-${tag}`,
      await seedWorkflow(`merchant-rules-store-a-wf-${tag}`),
    );
    const storeBBasketId = await seedBasket(
      `merchant-rules-store-b-${tag}`,
      await seedWorkflow(`merchant-rules-store-b-wf-${tag}`),
    );

    const storeA = await upsertShopifyStore(
      app,
      {
        shopifyShopId: tag + 1,
        shopDomain: `merchant-rules-a-${tag}.myshopify.com`,
        myshopifyDomain: `merchant-rules-a-${tag}.myshopify.com`,
        name: 'Store A',
        email: 'a@a.com',
      },
      'tok',
      'read_products',
    );
    storeAId = storeA.id;
    authA = { authorization: `Bearer ${signSessionToken(storeA.shopDomain, API_SECRET, API_KEY)}` };

    const storeB = await upsertShopifyStore(
      app,
      {
        shopifyShopId: tag + 2,
        shopDomain: `merchant-rules-b-${tag}.myshopify.com`,
        myshopifyDomain: `merchant-rules-b-${tag}.myshopify.com`,
        name: 'Store B',
        email: 'b@b.com',
      },
      'tok',
      'read_products',
    );
    storeBId = storeB.id;
    authB = { authorization: `Bearer ${signSessionToken(storeB.shopDomain, API_SECRET, API_KEY)}` };

    const [globalRule] = await app.db
      .insert(schema.shopifyFunnelRules)
      .values({
        storeId: null,
        funnelTemplateId: globalBasketId,
        conditions: [{ field: 'tags', operator: 'contains', value: 'global-tag' }],
        priority: 1,
      })
      .returning();
    globalRuleId = globalRule.id;

    const [storeARule] = await app.db
      .insert(schema.shopifyFunnelRules)
      .values({
        storeId: storeAId,
        funnelTemplateId: storeABasketId,
        conditions: [{ field: 'tags', operator: 'contains', value: 'store-a-tag' }],
        priority: 1,
      })
      .returning();
    storeARuleId = storeARule.id;

    const [storeBRule] = await app.db
      .insert(schema.shopifyFunnelRules)
      .values({
        storeId: storeBId,
        funnelTemplateId: storeBBasketId,
        conditions: [{ field: 'tags', operator: 'contains', value: 'store-b-tag' }],
        priority: 1,
      })
      .returning();
    storeBRuleId = storeBRule.id;

    // A store-A product that matches none of the seeded rules, so the counts
    // endpoint's resolution must fall through to the default basket.
    await app.db.insert(schema.shopifyProductGarments).values({
      storeId: storeAId,
      shopifyProductId: tag + 100,
      r2Key: `shopify-inputs/${storeAId}/${tag}/photo`,
      status: 'active',
      productType: 'unmatched',
      tags: ['nothing-here'],
    });
  });

  afterAll(async () => {
    await app.close();
    await c.stop();
  });

  it('never exposes workflowTemplateId on the baskets list', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/shopify/baskets', headers: authA });
    expect(res.statusCode).toBe(200);
    for (const item of res.json().items) {
      expect(item).not.toHaveProperty('workflowTemplateId');
    }
  });

  it('creates a store rule and rejects a duplicate for the same basket with 409', async () => {
    const body = {
      funnelTemplateId: upperBasketId,
      conditions: [{ field: 'tags', operator: 'equals', value: 'shirt' }],
      priority: 10,
    };
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/shopify/funnel-rules',
          headers: authA,
          payload: body,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/shopify/funnel-rules',
          headers: authA,
          payload: body,
        })
      ).statusCode,
    ).toBe(409);
  });

  it('rejects a rule with no conditions', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/shopify/funnel-rules',
      headers: authA,
      payload: { funnelTemplateId: upperBasketId, conditions: [], priority: 0 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('refuses to patch or delete a global rule', async () => {
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/v1/shopify/funnel-rules/${globalRuleId}`,
          headers: authA,
          payload: { priority: 1 },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/v1/shopify/funnel-rules/${globalRuleId}`,
          headers: authA,
        })
      ).statusCode,
    ).toBe(404);
  });

  it("refuses to patch another store's rule", async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/shopify/funnel-rules/${storeBRuleId}`,
      headers: authA,
      payload: { priority: 1 },
    });
    expect(res.statusCode).toBe(404);
  });

  it('suppresses a global rule for the calling store only', async () => {
    await app.inject({
      method: 'PUT',
      url: `/v1/shopify/funnel-rules/${globalRuleId}/disabled`,
      headers: authA,
      payload: { disabled: true },
    });

    const a = await app.inject({ method: 'GET', url: '/v1/shopify/funnel-rules', headers: authA });
    const b = await app.inject({ method: 'GET', url: '/v1/shopify/funnel-rules', headers: authB });
    expect(a.json().globalRules.find((r: { id: string }) => r.id === globalRuleId).disabled).toBe(
      true,
    );
    expect(b.json().globalRules.find((r: { id: string }) => r.id === globalRuleId).disabled).toBe(
      false,
    );
  });

  it("refuses to suppress the store's own rule", async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/v1/shopify/funnel-rules/${storeARuleId}/disabled`,
      headers: authA,
      payload: { disabled: true },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns per-basket counts', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/shopify/funnel-rules',
      headers: authA,
    });
    expect(res.json().countsOmitted).toBe(false);
    expect(res.json().counts[defaultBasketId]).toBeGreaterThan(0);
    // The unmatched product falls through to the active default basket, so
    // nothing is actually unrouted yet.
    expect(res.json().unrouted).toBe(0);
  });

  it('counts a product with no resolvable basket as unrouted, not silently dropped', async () => {
    // Deactivating the default removes the unmatched product's only fallback.
    // This is the last test in the file, so it's safe to leave the fixture
    // in this state.
    await app.db
      .update(schema.shopifyFunnelTemplates)
      .set({ isActive: false })
      .where(eq(schema.shopifyFunnelTemplates.id, defaultBasketId));

    const res = await app.inject({
      method: 'GET',
      url: '/v1/shopify/funnel-rules',
      headers: authA,
    });
    expect(res.json().countsOmitted).toBe(false);
    expect(res.json().counts[defaultBasketId]).toBeUndefined();
    expect(res.json().unrouted).toBe(1);
  });
});
