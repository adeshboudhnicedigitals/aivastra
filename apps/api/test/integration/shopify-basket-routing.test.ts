import { Buffer } from 'node:buffer';
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

describe('shopify try-on routes through basket resolution', () => {
  let c: Containers;
  let app: TestApp;

  // Shared basket/workflow config, seeded once — mirrors the global-rule setup
  // in shopify-funnel-loader.test.ts. Stores and garments are per-test (see
  // seedStore/seedGarment below), following shopify-refusal-events.test.ts:70-100,
  // so job/credit assertions in one test never see rows created by another.
  let defaultWorkflowId: string;
  let sareeWorkflowId: string;
  let upperWorkflowId: string;
  let upperBasketId: string;

  let storeCounter = 0;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);

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
        })
        .returning();
      return wf.id;
    }

    defaultWorkflowId = await seedWorkflow(`basket-routing-default-${Date.now()}`);
    sareeWorkflowId = await seedWorkflow(`basket-routing-saree-${Date.now()}`);
    upperWorkflowId = await seedWorkflow(`basket-routing-upper-${Date.now()}`);

    await app.db.insert(schema.shopifyFunnelTemplates).values({
      slug: `basket-routing-default-basket-${Date.now()}`,
      label: 'Default',
      workflowTemplateId: defaultWorkflowId,
      isDefault: true,
    });

    const [sareeBasket] = await app.db
      .insert(schema.shopifyFunnelTemplates)
      .values({
        slug: `basket-routing-saree-basket-${Date.now()}`,
        label: 'Saree',
        workflowTemplateId: sareeWorkflowId,
      })
      .returning();

    const [upperBasket] = await app.db
      .insert(schema.shopifyFunnelTemplates)
      .values({
        slug: `basket-routing-upper-basket-${Date.now()}`,
        label: 'Upper',
        workflowTemplateId: upperWorkflowId,
      })
      .returning();
    upperBasketId = upperBasket.id;

    // Global rule: any product tagged "saree" routes to the saree basket.
    await app.db.insert(schema.shopifyFunnelRules).values({
      storeId: null,
      funnelTemplateId: sareeBasket.id,
      conditions: [{ field: 'tags', operator: 'contains', value: 'saree' }],
      priority: 10,
    });
  });

  afterAll(async () => {
    await app.close();
    await c.stop();
  });

  async function seedStore() {
    const [store] = await app.db
      .insert(schema.shopifyStores)
      .values({
        shopDomain: `basket-routing-${Date.now()}-${storeCounter}.myshopify.com`,
        shopifyShopId: Date.now() * 1000 + storeCounter++,
        accessToken: 'enc',
        scope: 'read_products',
      })
      .returning();
    await app.db.insert(schema.shopifyStoreCredits).values({ storeId: store.id, balance: 100 });
    return store;
  }

  async function seedGarment(
    storeId: string,
    shopifyProductId: number,
    tags: string[] | null = null,
  ) {
    const [garment] = await app.db
      .insert(schema.shopifyProductGarments)
      .values({
        storeId,
        shopifyProductId,
        r2Key: `shopify-garments/${storeId}/${shopifyProductId}/garment.jpg`,
        title: 'Test Product',
        status: 'active',
        enabled: true,
        tags,
      })
      .returning();
    return garment;
  }

  async function uploadCustomerPhoto(storeKey: string) {
    const presign = await app.inject({
      method: 'POST',
      url: '/v1/shopify/customer/presign',
      headers: { 'x-widget-key': storeKey },
      payload: { contentType: 'image/jpeg', contentLength: 1024 },
    });
    expect(presign.statusCode).toBe(200);
    const { uploadUrl, r2Key } = presign.json() as { uploadUrl: string; r2Key: string };
    const put = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      body: Buffer.from('photo-bytes'),
    });
    expect(put.ok).toBe(true);
    return r2Key;
  }

  async function createTryon(
    store: { storeKey: string },
    { shopifyProductId }: { shopifyProductId: number },
  ) {
    const r2Key = await uploadCustomerPhoto(store.storeKey);
    return app.inject({
      method: 'POST',
      url: '/v1/shopify/customer/jobs',
      headers: { 'x-widget-key': store.storeKey },
      payload: { customerPhotoKey: r2Key, shopifyProductId },
    });
  }

  async function storeBalance(id: string) {
    const [row] = await app.db
      .select()
      .from(schema.shopifyStoreCredits)
      .where(eq(schema.shopifyStoreCredits.storeId, id));
    return row.balance;
  }

  it('runs the basket resolved by a global rule, not the default', async () => {
    const store = await seedStore();
    const sareeProductId = 5001;
    // garment tagged "saree"; global rule tags contains "saree" -> saree basket
    await seedGarment(store.id, sareeProductId, ['saree']);

    const res = await createTryon(store, { shopifyProductId: sareeProductId });
    expect(res.statusCode).toBe(201);
    const [inputs] = await app.db
      .select()
      .from(schema.jobInputs)
      .where(eq(schema.jobInputs.jobId, res.json().jobId));
    expect((inputs.params as { workflowTemplateId?: string }).workflowTemplateId).toBe(
      sareeWorkflowId,
    );
    expect((inputs.params as { workflowTemplateId?: string }).workflowTemplateId).not.toBe(
      defaultWorkflowId,
    );
  });

  it('honours a manual pin over a matching rule', async () => {
    const store = await seedStore();
    const sareeProductId = 5001;
    const garment = await seedGarment(store.id, sareeProductId, ['saree']);
    await app.db
      .update(schema.shopifyProductGarments)
      .set({ funnelTemplateId: upperBasketId, funnelAssignmentSource: 'manual' })
      .where(eq(schema.shopifyProductGarments.id, garment.id));

    const res = await createTryon(store, { shopifyProductId: sareeProductId });
    const [inputs] = await app.db
      .select()
      .from(schema.jobInputs)
      .where(eq(schema.jobInputs.jobId, res.json().jobId));
    expect((inputs.params as { workflowTemplateId?: string }).workflowTemplateId).toBe(
      upperWorkflowId,
    );
  });

  it('falls back to the default basket when no rule matches', async () => {
    const store = await seedStore();
    const untaggedProductId = 5002;
    await seedGarment(store.id, untaggedProductId);

    const res = await createTryon(store, { shopifyProductId: untaggedProductId });
    const [inputs] = await app.db
      .select()
      .from(schema.jobInputs)
      .where(eq(schema.jobInputs.jobId, res.json().jobId));
    expect((inputs.params as { workflowTemplateId?: string }).workflowTemplateId).toBe(
      defaultWorkflowId,
    );
  });

  // The critical one: refusal must happen BEFORE the deduct, not merely happen.
  // Must run last — it turns off the only default basket in this suite's DB,
  // which the earlier tests rely on for their fallback/rule assertions.
  it('refuses without deducting credits or creating a job when nothing resolves', async () => {
    await app.db
      .update(schema.shopifyFunnelTemplates)
      .set({ isDefault: false })
      .where(eq(schema.shopifyFunnelTemplates.isDefault, true));

    const store = await seedStore();
    const untaggedProductId = 5003;
    await seedGarment(store.id, untaggedProductId);

    const before = await storeBalance(store.id);
    const res = await createTryon(store, { shopifyProductId: untaggedProductId });

    expect(res.statusCode).toBe(202);
    expect(await storeBalance(store.id)).toBe(before);
    const jobs = await app.db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.shopifyStoreId, store.id));
    expect(jobs).toHaveLength(0);
  });
});
