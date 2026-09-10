import { schema } from '@aivastra/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadRuleSet } from '../../src/modules/shopify/funnel-resolution.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

describe('loadRuleSet', () => {
  let c: Containers;
  let app: TestApp;

  let storeA: string;
  let storeB: string;
  let sareeBasketId: string;
  let defaultBasketId: string;
  let globalRuleId: string;
  let storeRuleId: string;
  let suppressedRuleId: string;
  const sareeWorkflowVersion = 5;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);

    async function seedWorkflow(slug: string, version: number) {
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
          version,
        })
        .returning();
      return wf.id;
    }

    const sareeWorkflowId = await seedWorkflow(
      `funnel-loader-saree-${Date.now()}`,
      sareeWorkflowVersion,
    );
    const upperWorkflowId = await seedWorkflow(`funnel-loader-upper-${Date.now()}`, 1);
    const defaultWorkflowId = await seedWorkflow(`funnel-loader-default-${Date.now()}`, 1);

    const [sareeBasket] = await app.db
      .insert(schema.shopifyFunnelTemplates)
      .values({
        slug: `funnel-loader-saree-basket-${Date.now()}`,
        label: 'Saree',
        workflowTemplateId: sareeWorkflowId,
      })
      .returning();
    sareeBasketId = sareeBasket.id;

    const [upperBasket] = await app.db
      .insert(schema.shopifyFunnelTemplates)
      .values({
        slug: `funnel-loader-upper-basket-${Date.now()}`,
        label: 'Upper',
        workflowTemplateId: upperWorkflowId,
      })
      .returning();
    const upperBasketId = upperBasket.id;

    const [defaultBasket] = await app.db
      .insert(schema.shopifyFunnelTemplates)
      .values({
        slug: `funnel-loader-default-basket-${Date.now()}`,
        label: 'Default',
        workflowTemplateId: defaultWorkflowId,
        isDefault: true,
      })
      .returning();
    defaultBasketId = defaultBasket.id;

    const [sA] = await app.db
      .insert(schema.shopifyStores)
      .values({
        shopDomain: `funnel-loader-a-${Date.now()}.myshopify.com`,
        shopifyShopId: Date.now() * 1000 + 1,
        accessToken: 'enc',
        scope: 'read_products',
      })
      .returning();
    storeA = sA.id;

    const [sB] = await app.db
      .insert(schema.shopifyStores)
      .values({
        shopDomain: `funnel-loader-b-${Date.now()}.myshopify.com`,
        shopifyShopId: Date.now() * 1000 + 2,
        accessToken: 'enc',
        scope: 'read_products',
      })
      .returning();
    storeB = sB.id;

    // Global rule: any product tagged "saree" routes to the saree basket.
    const [globalRule] = await app.db
      .insert(schema.shopifyFunnelRules)
      .values({
        storeId: null,
        funnelTemplateId: sareeBasketId,
        conditions: [{ field: 'tags', operator: 'contains', value: 'saree' }],
        priority: 10,
      })
      .returning();
    globalRuleId = globalRule.id;

    // Store A's own rule, on a different basket.
    const [storeRule] = await app.db
      .insert(schema.shopifyFunnelRules)
      .values({
        storeId: storeA,
        funnelTemplateId: upperBasketId,
        conditions: [{ field: 'tags', operator: 'contains', value: 'shirt' }],
        priority: 5,
      })
      .returning();
    storeRuleId = storeRule.id;

    suppressedRuleId = globalRuleId;

    // Store A switches off the global saree rule for itself only.
    await app.db.insert(schema.shopifyStoreDisabledFunnelRules).values({
      storeId: storeA,
      ruleId: globalRuleId,
    });
  });

  afterAll(async () => {
    await app.close();
    await c.stop();
  });

  it('omits a suppressed global rule for that store only', async () => {
    const forStoreA = await loadRuleSet(app, storeA);
    const forStoreB = await loadRuleSet(app, storeB);
    expect(forStoreA.globalRules.map((r) => r.ruleId)).not.toContain(suppressedRuleId);
    expect(forStoreB.globalRules.map((r) => r.ruleId)).toContain(suppressedRuleId);
  });

  it('separates store rules from global rules', async () => {
    const set = await loadRuleSet(app, storeA);
    expect(set.storeRules.every((r) => r.ruleId !== globalRuleId)).toBe(true);
    expect(set.globalRules.every((r) => r.ruleId !== storeRuleId)).toBe(true);
  });

  it('exposes the active default basket id', async () => {
    const set = await loadRuleSet(app, storeA);
    expect(set.defaultBasketId).toBe(defaultBasketId);
  });

  it('carries the workflow template version onto each basket', async () => {
    const set = await loadRuleSet(app, storeA);
    expect(set.baskets.get(sareeBasketId)?.workflowTemplateVersion).toBe(sareeWorkflowVersion);
  });
});
