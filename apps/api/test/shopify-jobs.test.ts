import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { upsertShopifyStore } from '../src/modules/shopify/auth.routes.js';
import { buildTestApp, type TestApp } from './helpers/api.js';
import { type Containers, startContainers } from './helpers/containers.js';

const ENC_KEY = Buffer.alloc(32, 9).toString('base64');
let c: Containers;
let app: TestApp;
let widgetKey: string;
let storeId: string;
let widgetClientId: string;

beforeAll(async () => {
  c = await startContainers();
  app = await buildTestApp(c, { SHOPIFY_TOKEN_ENC_KEY: ENC_KEY, SHOPIFY_JOB_COST: 10 });
  const store = await upsertShopifyStore(
    app,
    {
      shopifyShopId: 21,
      shopDomain: 'j.myshopify.com',
      myshopifyDomain: 'j.myshopify.com',
      name: 'J',
      email: 'j@j.com',
    },
    'tok',
    'read_products',
  );
  storeId = store.id;
  widgetClientId = store.widgetClientId;
  // seed credits + a synced garment + a resolvable customer photo
  await app.db
    .update(schema.widgetClientCredits)
    .set({ balance: 100 })
    .where(eq(schema.widgetClientCredits.widgetClientId, widgetClientId));
  await app.db.insert(schema.shopifyProductGarments).values({
    storeId,
    shopifyProductId: 88,
    shopifyVariantId: null,
    r2Key: `shopify-garments/${storeId}/88/garment.jpg`,
    status: 'active',
  });
  const [wc] = await app.db
    .select()
    .from(schema.widgetClients)
    .where(eq(schema.widgetClients.id, widgetClientId));
  widgetKey = wc.widgetKey;
  // upload a customer photo + register ownership (mirror widget presign flow)
  const photoKey = `widget-inputs/${widgetClientId}/photo.jpg`;
  await app.storage.putObject(photoKey, Buffer.from([1, 2, 3]), 'image/jpeg');
  await app.redis.set(`widget:upload:${photoKey}`, widgetClientId);
});
afterAll(async () => {
  await app?.close();
  await c?.stop();
});

describe('shopify widget job', () => {
  it('creates a shopify job resolving garment from R2 and tags params.kind', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/widget/jobs',
      headers: {
        'x-widget-key': widgetKey,
        'content-type': 'application/json',
        origin: 'https://j.myshopify.com',
      },
      payload: {
        shopifyProductId: 88,
        customerPhotoKey: `widget-inputs/${widgetClientId}/photo.jpg`,
      },
    });
    expect(res.statusCode).toBe(201);
    const jobId = res.json().jobId;
    const [inputs] = await app.db
      .select()
      .from(schema.jobInputs)
      .where(eq(schema.jobInputs.jobId, jobId));
    const params = typeof inputs.params === 'string' ? JSON.parse(inputs.params) : inputs.params;
    expect(params.kind).toBe('shopify');
    expect(params.shopifyProductId).toBe(88);
    expect(inputs.upperGarmentKey).toBe(`shopify-garments/${storeId}/88/garment.jpg`);
    const [job] = await app.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    expect(job.creditsCharged).toBe(10);
  });

  it('returns 202 when the product is not synced yet', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/widget/jobs',
      headers: {
        'x-widget-key': widgetKey,
        'content-type': 'application/json',
        origin: 'https://j.myshopify.com',
      },
      payload: {
        shopifyProductId: 404404,
        customerPhotoKey: `widget-inputs/${widgetClientId}/photo.jpg`,
      },
    });
    expect(res.statusCode).toBe(202);
  });
});
