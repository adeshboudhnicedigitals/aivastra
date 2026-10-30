import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resolveShopifyWorkflow } from '../../src/modules/shopify/workflow.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

const CONFIG_KEY = 'config:system';

describe('resolveShopifyWorkflow', () => {
  let c: Containers;
  let app: TestApp;
  let wfA: string;
  let wfB: string;

  async function seedWorkflow(slug: string, isActive = true) {
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
        isActive,
      })
      .returning();
    return wf.id;
  }

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
    wfA = await seedWorkflow(`swf-a-${Date.now()}`);
    wfB = await seedWorkflow(`swf-b-${Date.now()}`);
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await c.stop();
  });

  beforeEach(async () => {
    await app.redis.del(CONFIG_KEY);
    await app.db.delete(schema.shopifyFunnelTemplates);
  });

  it('returns the configured workflow', async () => {
    await app.redis.set(CONFIG_KEY, JSON.stringify({ shopifyWorkflowTemplateId: wfA }));
    const r = await resolveShopifyWorkflow(app);
    expect(r).toMatchObject({ workflowTemplateId: wfA, source: 'config' });
    expect(r?.workflowTemplateVersion).toBeTypeOf('number');
  });

  it('returns null when the configured workflow is inactive', async () => {
    const inactive = await seedWorkflow(`swf-off-${Date.now()}`, false);
    await app.redis.set(CONFIG_KEY, JSON.stringify({ shopifyWorkflowTemplateId: inactive }));
    expect(await resolveShopifyWorkflow(app)).toBeNull();
  });

  it('returns null when the configured workflow does not exist', async () => {
    await app.redis.set(
      CONFIG_KEY,
      JSON.stringify({ shopifyWorkflowTemplateId: '00000000-0000-4000-8000-000000000000' }),
    );
    expect(await resolveShopifyWorkflow(app)).toBeNull();
  });

  async function seedBasket(workflowTemplateId: string, isActive = true) {
    await app.db.insert(schema.shopifyFunnelTemplates).values({
      slug: `swf-basket-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      label: 'Basket',
      workflowTemplateId,
      isActive,
    });
  }

  it('shim: unset config uses the workflow every active funnel template shares', async () => {
    await seedBasket(wfB);
    await seedBasket(wfB);
    const r = await resolveShopifyWorkflow(app);
    expect(r).toMatchObject({ workflowTemplateId: wfB, source: 'sole_basket_workflow' });
  });

  it('shim: ignores inactive funnel templates when counting distinct workflows', async () => {
    await seedBasket(wfB);
    await seedBasket(wfA, false);
    expect((await resolveShopifyWorkflow(app))?.workflowTemplateId).toBe(wfB);
  });

  it('shim: refuses when active funnel templates disagree', async () => {
    await seedBasket(wfA);
    await seedBasket(wfB);
    expect(await resolveShopifyWorkflow(app)).toBeNull();
  });

  it('config wins over the funnel templates', async () => {
    await seedBasket(wfB);
    await app.redis.set(CONFIG_KEY, JSON.stringify({ shopifyWorkflowTemplateId: wfA }));
    expect((await resolveShopifyWorkflow(app))?.workflowTemplateId).toBe(wfA);
  });

  it('returns null when nothing is configured and there are no funnel templates', async () => {
    expect(await resolveShopifyWorkflow(app)).toBeNull();
  });
});
