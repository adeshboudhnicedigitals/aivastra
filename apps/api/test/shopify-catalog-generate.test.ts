import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { upsertShopifyStore } from '../src/modules/shopify/auth.routes.js';
import { buildTestApp, type TestApp } from './helpers/api.js';
import { type Containers, startContainers } from './helpers/containers.js';
import { signSessionToken } from './helpers/shopify-session.js';

const ENC_KEY = Buffer.alloc(32, 21).toString('base64');
const API_SECRET = 'gen-secret';
const API_KEY = 'gen-key';
let c: Containers;
let app: TestApp;
let token: string;
let storeId: string;
let faceId: string;
let backgroundId: string;
let poseId: string;

beforeAll(async () => {
  c = await startContainers();
  app = await buildTestApp(c, {
    SHOPIFY_TOKEN_ENC_KEY: ENC_KEY,
    SHOPIFY_API_SECRET: API_SECRET,
    SHOPIFY_API_KEY: API_KEY,
  });

  const owner = await app.db
    .insert(schema.users)
    .values({
      email: `catalog-gen-${Date.now()}@example.com`,
      passwordHash: null,
      displayName: 'Owner',
      companyName: null,
      emailVerified: true,
      tier: 'free',
    })
    .returning();
  await app.db.insert(schema.userCredits).values({ userId: owner[0].id, balance: 1000 });

  const store = await upsertShopifyStore(
    app,
    {
      shopifyShopId: 701,
      shopDomain: 'catalog-generate-test.myshopify.com',
      myshopifyDomain: 'catalog-generate-test.myshopify.com',
      name: 'G',
      email: 'g@g.com',
    },
    'tok',
    'read_products',
  );
  await app.db
    .update(schema.shopifyStores)
    .set({ ownerUserId: owner[0].id })
    .where(eq(schema.shopifyStores.id, store.id));
  storeId = store.id;
  token = signSessionToken('catalog-generate-test.myshopify.com', API_SECRET, API_KEY);

  const [face] = await app.db
    .insert(schema.modelFaces)
    .values({
      gender: 'women',
      label: 'F',
      thumbnailKey: 'f.jpg',
      r2Key: 'f-full.jpg',
      isActive: true,
    })
    .returning();
  faceId = face.id;
  const [bg] = await app.db
    .insert(schema.modelBackgrounds)
    .values({
      label: 'B',
      r2Key: 'bg.jpg',
      thumbnailKey: 'bg-t.jpg',
      bgComfyR2Key: 'bg-comfy.jpg',
      isActive: true,
    })
    .returning();
  backgroundId = bg.id;
  const [wf] = await app.db
    .insert(schema.workflowTemplates)
    .values({
      slug: 'catalog-gen-wf',
      label: 'WF',
      jsonContent: {},
      faceNodeId: 'x',
      poseNodeId: 'x',
      bgNodeId: 'x',
      upperNodeIds: ['1'],
      facePhasePromptNode: 'x',
      garmentPhasePromptNode: 'x',
      workflowType: 'tryon',
    })
    .returning();
  const [pose] = await app.db
    .insert(schema.modelPoseAssets)
    .values({
      genderSlug: 'women',
      label: 'P',
      displayName: 'P',
      r2Key: 'pose.jpg',
      thumbnailKey: 'pose-t.jpg',
      isActive: true,
      workflowTemplateId: wf.id,
    })
    .returning();
  poseId = pose.id;

  // Stub the outbound fetch to (a) the Shopify Admin GraphQL endpoint the
  // route now calls to confirm sourceImageUrl belongs to the product (fetchLiveProductImages,
  // products.routes.ts), and (b) the Shopify CDN image download itself — so the test
  // doesn't depend on network access. createJob only needs the object to exist in R2
  // with a readable size, not real image bytes. The GraphQL stub returns every
  // sourceImageUrl used across this file's tests as "live" images of the product, so
  // each test's legitimate sourceImageUrl matches.
  const LIVE_IMAGE_URLS = [
    'https://cdn.shopify.com/s/files/1/0/0/products/shirt.jpg',
    'https://cdn.shopify.com/s/files/1/0/0/products/shirt-bad-face.jpg',
  ];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (typeof url === 'string' && url.includes('/graphql.json')) {
        return new Response(
          JSON.stringify({
            data: {
              product: {
                images: {
                  nodes: LIVE_IMAGE_URLS.map((imageUrl, i) => ({
                    id: `gid://shopify/ProductImage/${i}`,
                    url: imageUrl,
                  })),
                },
              },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (typeof url === 'string' && url.includes('cdn.shopify.com')) {
        return new Response(Buffer.from('fake-jpeg-bytes'), {
          status: 200,
          headers: { 'content-type': 'image/jpeg' },
        });
      }
      throw new Error(`unexpected fetch in test: ${url}`);
    }),
  );
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await app?.close();
  await c?.stop();
});

describe('POST /v1/shopify/catalog/generate', () => {
  it('rejects without a session token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/shopify/catalog/generate',
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it('creates one job per look, billed to the store owner', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/shopify/catalog/generate',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        shopifyProductId: 12345,
        sourceImageUrl: 'https://cdn.shopify.com/s/files/1/0/0/products/shirt.jpg',
        faceId,
        looks: [{ poseId, backgroundId }],
        aspectRatio: '3:4',
        resolution: 'HD',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { catalogueId: string; jobIds: string[] };
    expect(body.jobIds).toHaveLength(1);

    const [tracked] = await app.db
      .select()
      .from(schema.shopifyCatalogJobs)
      .where(eq(schema.shopifyCatalogJobs.jobId, body.jobIds[0]));
    expect(tracked.storeId).toBe(storeId);
    expect(tracked.shopifyProductId).toBe(12345);
  });

  it('deletes the uploaded R2 object when createJob fails afterward', async () => {
    // faceId is a well-formed but non-existent UUID, so createJob throws
    // BAD_CATALOG only after downloadProductImageToR2 has already written
    // the object to R2 — this is what exercises the cleanup path.
    const putObjectSpy = vi.spyOn(app.storage, 'putObject');

    const res = await app.inject({
      method: 'POST',
      url: '/v1/shopify/catalog/generate',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        shopifyProductId: 999,
        sourceImageUrl: 'https://cdn.shopify.com/s/files/1/0/0/products/shirt-bad-face.jpg',
        faceId: '00000000-0000-0000-0000-000000000000',
        looks: [{ poseId, backgroundId }],
        aspectRatio: '3:4',
        resolution: 'HD',
      },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('BAD_CATALOG');

    expect(putObjectSpy).toHaveBeenCalledTimes(1);
    const uploadedKey = putObjectSpy.mock.calls[0][0];
    expect(uploadedKey).toMatch(/^shopify-catalog-garments\//);
    await expect(app.storage.headObject(uploadedKey)).rejects.toBeTruthy();

    putObjectSpy.mockRestore();
  });

  it('rejects when the store has no linked owner', async () => {
    const unlinked = await upsertShopifyStore(
      app,
      {
        shopifyShopId: 702,
        shopDomain: 'catalog-generate-unlinked.myshopify.com',
        myshopifyDomain: 'catalog-generate-unlinked.myshopify.com',
        name: 'U',
        email: 'u@u.com',
      },
      'tok',
      'read_products',
    );
    const unlinkedToken = signSessionToken(
      'catalog-generate-unlinked.myshopify.com',
      API_SECRET,
      API_KEY,
    );
    const res = await app.inject({
      method: 'POST',
      url: '/v1/shopify/catalog/generate',
      headers: { authorization: `Bearer ${unlinkedToken}` },
      payload: {
        shopifyProductId: 1,
        sourceImageUrl: 'https://cdn.shopify.com/s/files/1/0/0/products/shirt.jpg',
        faceId,
        looks: [{ poseId, backgroundId }],
        aspectRatio: '3:4',
        resolution: 'HD',
      },
    });
    expect(res.statusCode).toBe(402);
    void unlinked;
  });

  it("rejects a sourceImageUrl that isn't one of the product's current live images", async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/shopify/catalog/generate',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        shopifyProductId: 12345,
        sourceImageUrl: 'https://cdn.shopify.com/s/files/1/0/0/products/not-a-real-image.jpg',
        faceId,
        looks: [{ poseId, backgroundId }],
        aspectRatio: '3:4',
        resolution: 'HD',
      },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(body.error.message).toContain("not one of this product's current images");
  });

  it('rejects a source image above the admin-configured Shopify catalogue limit', async () => {
    await app.redis.set(
      'config:system',
      JSON.stringify({ uploadLimits: { shopifyCatalogSourceMaxBytes: 5 } }),
    );
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/shopify/catalog/generate',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        payload: JSON.stringify({
          shopifyProductId: 1,
          sourceImageUrl: 'https://cdn.shopify.com/s/files/1/0/0/products/shirt.jpg',
          faceId,
          looks: [{ poseId, backgroundId }],
          aspectRatio: '3:4',
          resolution: 'HD',
        }),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.message).toContain('MB');
    } finally {
      await app.redis.del('config:system');
    }
  });
});
