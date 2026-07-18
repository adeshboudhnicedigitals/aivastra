import { schema } from '@aivastra/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { upsertShopifyStore } from '../src/modules/shopify/auth.routes.js';
import { buildTestApp, type TestApp } from './helpers/api.js';
import { type Containers, startContainers } from './helpers/containers.js';
import { signSessionToken } from './helpers/shopify-session.js';

const ENC_KEY = Buffer.alloc(32, 21).toString('base64');
const API_SECRET = 'jobs-secret';
const API_KEY = 'jobs-key';
let c: Containers;
let app: TestApp;
let token: string;
let storeId: string;
let catalogueId: string;
let jobId: string;

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
      shopifyShopId: 801,
      shopDomain: 'catalog-jobs-test.myshopify.com',
      myshopifyDomain: 'catalog-jobs-test.myshopify.com',
      name: 'J',
      email: 'j@j.com',
    },
    'tok',
    'read_products',
  );
  storeId = store.id;
  token = signSessionToken('catalog-jobs-test.myshopify.com', API_SECRET, API_KEY);

  catalogueId = crypto.randomUUID();
  const [job] = await app.db
    .insert(schema.jobs)
    .values({ catalogueId, status: 'COMPLETED', creditsCharged: 25, source: 'catalog' })
    .returning();
  jobId = job.id;
  await app.db
    .insert(schema.jobOutputs)
    .values({ jobId, resultKey: `outputs/${jobId}/result.png` });
  await app.db.insert(schema.shopifyCatalogJobs).values({
    jobId,
    storeId,
    shopifyProductId: 999,
    sourceImageUrl: 'https://cdn.shopify.com/s/files/1/0/0/products/x.jpg',
  });
});
afterAll(async () => {
  await app?.close();
  await c?.stop();
});

describe('GET /v1/shopify/catalog/jobs', () => {
  it('rejects without a session token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/shopify/catalog/jobs?catalogueId=${catalogueId}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects with 401 (not 400) when the querystring is malformed and there is no session token', async () => {
    // catalogueId is required/uuid — omitting it entirely makes the querystring
    // invalid. Auth must run before validation, so this must still be 401, not 400.
    // Proves the preHandler-then-manual-parse fix (mirroring generate's own fix).
    const res = await app.inject({
      method: 'GET',
      url: '/v1/shopify/catalog/jobs',
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns the job with a result URL, scoped to the session store', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/shopify/catalog/jobs?catalogueId=${catalogueId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      items: { jobId: string; status: string; resultUrl: string | null; published: boolean }[];
    };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].jobId).toBe(jobId);
    expect(body.items[0].status).toBe('COMPLETED');
    expect(body.items[0].resultUrl).toContain(jobId);
    expect(body.items[0].published).toBe(false);
  });

  it('returns the job when queried by shopifyProductId instead of catalogueId', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/shopify/catalog/jobs?shopifyProductId=999',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      items: { jobId: string; catalogueId: string; sourceImageUrl: string }[];
    };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].jobId).toBe(jobId);
    expect(body.items[0].catalogueId).toBe(catalogueId);
    expect(body.items[0].sourceImageUrl).toBe(
      'https://cdn.shopify.com/s/files/1/0/0/products/x.jpg',
    );
  });

  it('rejects 400 when authenticated but neither catalogueId nor shopifyProductId is given', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/shopify/catalog/jobs',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it('excludes jobs belonging to a different store', async () => {
    const otherStore = await upsertShopifyStore(
      app,
      {
        shopifyShopId: 802,
        shopDomain: 'catalog-jobs-other.myshopify.com',
        myshopifyDomain: 'catalog-jobs-other.myshopify.com',
        name: 'O',
        email: 'o@o.com',
      },
      'tok',
      'read_products',
    );
    const otherToken = signSessionToken('catalog-jobs-other.myshopify.com', API_SECRET, API_KEY);
    const res = await app.inject({
      method: 'GET',
      url: `/v1/shopify/catalog/jobs?catalogueId=${catalogueId}`,
      headers: { authorization: `Bearer ${otherToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: unknown[] };
    expect(body.items).toHaveLength(0);
    void otherStore;
  });
});
