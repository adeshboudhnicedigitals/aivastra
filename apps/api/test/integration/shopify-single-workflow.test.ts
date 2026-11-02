import { Buffer } from 'node:buffer';
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

describe('shopify try-on uses one configured workflow', () => {
  let c: Containers;
  let app: TestApp;

  // Shared basket/workflow config, seeded once — mirrors the global-rule setup
  // in shopify-funnel-loader.test.ts. Stores and garments are per-test (see
  // seedStore/seedGarment below), following shopify-refusal-events.test.ts:70-100,
  // so job/credit assertions in one test never see rows created by another.
  let workflowId: string;
  let workflowVersion: number;

  let storeCounter = 0;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);

    const [workflow] = await app.db
      .insert(schema.workflowTemplates)
      .values({
        slug: `single-workflow-${Date.now()}`,
        label: 'Single workflow',
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
    workflowId = workflow.id;
    workflowVersion = workflow.version;
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

  it('runs a product with no funnel data through the configured workflow', async () => {
    const store = await seedStore();
    await app.redis.set('config:system', JSON.stringify({ shopifyWorkflowTemplateId: workflowId }));
    const productId = 5001;
    await seedGarment(store.id, productId);

    const res = await createTryon(store, { shopifyProductId: productId });
    expect(res.statusCode).toBe(201);
    const [inputs] = await app.db
      .select()
      .from(schema.jobInputs)
      .where(eq(schema.jobInputs.jobId, res.json().jobId));
    expect((inputs.params as { workflowTemplateId?: string }).workflowTemplateId).toBe(workflowId);
    expect((inputs.params as { dispatchTemplateVersion?: number }).dispatchTemplateVersion).toBe(
      workflowVersion,
    );
  });

  it('pins the same workflow for products with different product metadata', async () => {
    const store = await seedStore();
    await app.redis.set('config:system', JSON.stringify({ shopifyWorkflowTemplateId: workflowId }));
    await seedGarment(store.id, 5001, ['saree']);
    const second = await seedGarment(store.id, 5002, ['shirt']);
    await app.db
      .update(schema.shopifyProductGarments)
      .set({ productType: 'tops', vendor: 'other', collections: ['new'] })
      .where(eq(schema.shopifyProductGarments.id, second.id));

    const firstRes = await createTryon(store, { shopifyProductId: 5001 });
    const secondRes = await createTryon(store, { shopifyProductId: 5002 });
    const [firstInputs] = await app.db
      .select()
      .from(schema.jobInputs)
      .where(eq(schema.jobInputs.jobId, firstRes.json().jobId));
    const [secondInputs] = await app.db
      .select()
      .from(schema.jobInputs)
      .where(eq(schema.jobInputs.jobId, secondRes.json().jobId));
    expect((firstInputs.params as { workflowTemplateId?: string }).workflowTemplateId).toBe(
      workflowId,
    );
    expect((secondInputs.params as { workflowTemplateId?: string }).workflowTemplateId).toBe(
      workflowId,
    );
  });

  // The critical one: refusal must happen BEFORE the deduct, not merely happen.
  it('refuses without deducting credits or creating a job when nothing resolves', async () => {
    const store = await seedStore();
    const untaggedProductId = 5003;
    await seedGarment(store.id, untaggedProductId);
    await app.redis.del('config:system');

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
