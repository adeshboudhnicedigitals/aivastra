import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { upsertShopifyStore } from '../src/modules/shopify/auth.routes.js';
import { createProductMedia } from '../src/modules/shopify/catalog-publish.js';
import { buildTestApp, type TestApp } from './helpers/api.js';
import { type Containers, startContainers } from './helpers/containers.js';
import { signSessionToken } from './helpers/shopify-session.js';

const API_SECRET = 'pub-secret';
const API_KEY = 'pub-key';
const ENC_KEY = Buffer.alloc(32, 33).toString('base64');
let c: Containers;
let app: TestApp;
let token: string;
let storeId: string;

beforeAll(async () => {
  c = await startContainers();
  app = await buildTestApp(c, {
    SHOPIFY_API_SECRET: API_SECRET,
    SHOPIFY_API_KEY: API_KEY,
    SHOPIFY_TOKEN_ENC_KEY: ENC_KEY,
  });
  const store = await upsertShopifyStore(
    app,
    {
      shopifyShopId: 901,
      shopDomain: 'catalog-publish-test.myshopify.com',
      myshopifyDomain: 'catalog-publish-test.myshopify.com',
      name: 'P',
      email: 'p@p.com',
    },
    'plaintext-access-token',
    'read_products,write_products',
  );
  storeId = store.id;
  token = signSessionToken('catalog-publish-test.myshopify.com', API_SECRET, API_KEY);
});
afterAll(async () => {
  await app?.close();
  await c?.stop();
});

describe('createProductMedia', () => {
  it('posts a productCreateMedia mutation and returns the media GID', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          data: {
            productCreateMedia: {
              media: [{ id: 'gid://shopify/MediaImage/123' }],
              mediaUserErrors: [],
            },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const mediaId = await createProductMedia(
      'catalog-publish-test.myshopify.com',
      'plaintext-access-token',
      555,
      'https://r2.example.com/signed/output.png',
    );
    expect(mediaId).toBe('gid://shopify/MediaImage/123');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/admin/api/'),
      expect.objectContaining({ method: 'POST' }),
    );
    vi.unstubAllGlobals();
  });

  it('throws when Shopify returns mediaUserErrors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: {
                productCreateMedia: {
                  media: [],
                  mediaUserErrors: [{ message: 'Product not found' }],
                },
              },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      ),
    );
    await expect(
      createProductMedia('catalog-publish-test.myshopify.com', 'tok', 1, 'https://x/y.png'),
    ).rejects.toThrow('Product not found');
    vi.unstubAllGlobals();
  });
});

describe('POST /v1/shopify/catalog/jobs/:id/publish', () => {
  it('rejects without a session token', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/shopify/catalog/jobs/x/publish' });
    expect(res.statusCode).toBe(401);
  });

  it('publishes a completed job and is idempotent on a second call', async () => {
    const [job] = await app.db
      .insert(schema.jobs)
      .values({ status: 'COMPLETED', creditsCharged: 25, source: 'catalog' })
      .returning();
    await app.db
      .insert(schema.jobOutputs)
      .values({ jobId: job.id, resultKey: `outputs/${job.id}/result.png` });
    await app.db.insert(schema.shopifyCatalogJobs).values({
      jobId: job.id,
      storeId,
      shopifyProductId: 42,
      sourceImageUrl: 'https://cdn.shopify.com/s/files/1/0/0/products/x.jpg',
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: {
                productCreateMedia: {
                  media: [{ id: 'gid://shopify/MediaImage/999' }],
                  mediaUserErrors: [],
                },
              },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      ),
    );

    const first = await app.inject({
      method: 'POST',
      url: `/v1/shopify/catalog/jobs/${job.id}/publish`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(first.statusCode).toBe(200);
    expect((first.json() as { mediaId: string }).mediaId).toBe('gid://shopify/MediaImage/999');

    const second = await app.inject({
      method: 'POST',
      url: `/v1/shopify/catalog/jobs/${job.id}/publish`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(second.statusCode).toBe(200);
    expect((second.json() as { mediaId: string }).mediaId).toBe('gid://shopify/MediaImage/999');

    const [tracked] = await app.db
      .select()
      .from(schema.shopifyCatalogJobs)
      .where(eq(schema.shopifyCatalogJobs.jobId, job.id));
    expect(tracked.publishedAt).not.toBeNull();

    vi.unstubAllGlobals();
  });

  it('rejects publishing a job that has not completed', async () => {
    const [job] = await app.db
      .insert(schema.jobs)
      .values({ status: 'PROCESSING', creditsCharged: 25, source: 'catalog' })
      .returning();
    await app.db.insert(schema.shopifyCatalogJobs).values({
      jobId: job.id,
      storeId,
      shopifyProductId: 43,
      sourceImageUrl: 'https://cdn.shopify.com/s/files/1/0/0/products/x.jpg',
    });

    const res = await app.inject({
      method: 'POST',
      url: `/v1/shopify/catalog/jobs/${job.id}/publish`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(409);
  });
});
