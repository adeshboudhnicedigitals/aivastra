import { Buffer } from 'node:buffer';
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp } from '../helpers/api.js';
import { startContainers } from '../helpers/containers.js';

describe('shopify customer routes', () => {
  let ctx: Awaited<ReturnType<typeof startContainers>>;
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  beforeAll(async () => {
    ctx = await startContainers();
    app = await buildTestApp(ctx);
  });
  afterAll(async () => {
    await app.close();
    await ctx.stop();
  });

  async function seedOwner(balance: number) {
    const [user] = await app.db
      .insert(schema.users)
      .values({
        email: `owner-${Date.now()}-${Math.random()}@example.com`,
        passwordHash: null,
        displayName: 'Store Owner',
        companyName: null,
        emailVerified: true,
        tier: 'free',
      })
      .returning();
    await app.db.insert(schema.userCredits).values({ userId: user.id, balance });
    return user;
  }

  async function seedStore(ownerUserId: string | null) {
    const [store] = await app.db
      .insert(schema.shopifyStores)
      .values({
        shopDomain: `test-${Date.now()}-${Math.random()}.myshopify.com`,
        shopifyShopId: Date.now(),
        accessToken: 'enc',
        scope: 'read_products',
        ownerUserId,
      })
      .returning();
    return store;
  }

  async function seedGarment(storeId: string, shopifyProductId: number) {
    const [garment] = await app.db
      .insert(schema.shopifyProductGarments)
      .values({
        storeId,
        shopifyProductId,
        r2Key: `shopify-garments/${storeId}/${shopifyProductId}/garment.jpg`,
        title: 'Test Product',
        status: 'active',
        enabled: true,
      })
      .returning();
    return garment;
  }

  async function uploadCustomerPhoto(storeKey: string, bytes: Buffer) {
    const presign = await app.inject({
      method: 'POST',
      url: '/v1/shopify/customer/presign',
      headers: { 'x-widget-key': storeKey },
      payload: { contentType: 'image/jpeg', contentLength: bytes.length },
    });
    expect(presign.statusCode).toBe(200);
    const { uploadUrl, r2Key } = presign.json() as { uploadUrl: string; r2Key: string };
    const put = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      body: bytes,
    });
    expect(put.ok).toBe(true);
    return r2Key;
  }

  it('rejects presign without a store key', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/shopify/customer/presign',
      payload: { contentType: 'image/jpeg', contentLength: 1024 },
    });
    expect(res.statusCode).toBe(401);
  });

  it('the account/exchange route no longer exists', async () => {
    const store = await seedStore(null);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/shopify/customer/account/exchange',
      headers: { 'x-widget-key': store.storeKey },
      payload: { code: 'whatever' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('rejects job creation when the store has no linked owner', async () => {
    const store = await seedStore(null);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/shopify/customer/jobs',
      headers: { 'x-widget-key': store.storeKey },
      payload: { customerPhotoKey: 'shopify-inputs/x/photo.jpg', shopifyProductId: 1 },
    });
    expect(res.statusCode).toBe(402);
  });

  it('rejects job creation when the owner has insufficient credits', async () => {
    const owner = await seedOwner(0);
    const store = await seedStore(owner.id);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/shopify/customer/jobs',
      headers: { 'x-widget-key': store.storeKey },
      payload: { customerPhotoKey: 'shopify-inputs/x/photo.jpg', shopifyProductId: 1 },
    });
    expect(res.statusCode).toBe(402);
  });

  it('creates a job billed to the store owner and deducts their credits, needing no shopper auth at all', async () => {
    const owner = await seedOwner(100);
    const store = await seedStore(owner.id);
    const r2Key = await uploadCustomerPhoto(store.storeKey, Buffer.from('photo-bytes'));
    await seedGarment(store.id, 7);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/shopify/customer/jobs',
      headers: { 'x-widget-key': store.storeKey },
      payload: { customerPhotoKey: r2Key, shopifyProductId: 7 },
    });
    expect(res.statusCode).toBe(201);
    const { jobId } = res.json() as { jobId: string };

    const [job] = await app.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    expect(job.userId).toBe(owner.id);
    expect(job.source).toBe('shopify');

    const [credits] = await app.db
      .select()
      .from(schema.userCredits)
      .where(eq(schema.userCredits.userId, owner.id));
    expect(credits.balance).toBeLessThan(100);
  });

  it('scopes job status/events by store, not by shopper identity', async () => {
    const owner = await seedOwner(100);
    const store = await seedStore(owner.id);
    const otherStore = await seedStore(null);
    const r2Key = await uploadCustomerPhoto(store.storeKey, Buffer.from('photo-bytes'));
    await seedGarment(store.id, 9);

    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/shopify/customer/jobs',
      headers: { 'x-widget-key': store.storeKey },
      payload: { customerPhotoKey: r2Key, shopifyProductId: 9 },
    });
    expect(createRes.statusCode).toBe(201);
    const { jobId } = createRes.json() as { jobId: string };

    const ownRes = await app.inject({
      method: 'GET',
      url: `/v1/shopify/customer/jobs/${jobId}`,
      headers: { 'x-widget-key': store.storeKey },
    });
    expect(ownRes.statusCode).toBe(200);
    const ownBody = ownRes.json();
    expect(ownBody).toHaveProperty('id', jobId);
    expect(ownBody).toHaveProperty('status');
    expect(ownBody).toHaveProperty('resultUrl');
    expect(ownBody).not.toHaveProperty('shopifyStoreId');

    const otherRes = await app.inject({
      method: 'GET',
      url: `/v1/shopify/customer/jobs/${jobId}`,
      headers: { 'x-widget-key': otherStore.storeKey },
    });
    expect(otherRes.statusCode).toBe(404);
  });

  it('extends the upload ownership TTL to 24h after a successful job creation', async () => {
    const owner = await seedOwner(100);
    const store = await seedStore(owner.id);
    const r2Key = await uploadCustomerPhoto(store.storeKey, Buffer.from('photo-bytes'));
    await seedGarment(store.id, 11);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/shopify/customer/jobs',
      headers: { 'x-widget-key': store.storeKey },
      payload: { customerPhotoKey: r2Key, shopifyProductId: 11 },
    });
    expect(res.statusCode).toBe(201);

    const ttl = await app.redis.ttl(`shopify:upload:${r2Key}`);
    expect(ttl).toBeGreaterThan(600);
    expect(ttl).toBeLessThanOrEqual(86400);
  });

  it('reuses the same photo for a second, different product', async () => {
    const owner = await seedOwner(100);
    const store = await seedStore(owner.id);
    const r2Key = await uploadCustomerPhoto(store.storeKey, Buffer.from('photo-bytes'));
    await seedGarment(store.id, 12);
    await seedGarment(store.id, 13);

    const first = await app.inject({
      method: 'POST',
      url: '/v1/shopify/customer/jobs',
      headers: { 'x-widget-key': store.storeKey },
      payload: { customerPhotoKey: r2Key, shopifyProductId: 12 },
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: 'POST',
      url: '/v1/shopify/customer/jobs',
      headers: { 'x-widget-key': store.storeKey },
      payload: { customerPhotoKey: r2Key, shopifyProductId: 13 },
    });
    expect(second.statusCode).toBe(201);
    expect((second.json() as { jobId: string }).jobId).not.toBe(
      (first.json() as { jobId: string }).jobId,
    );
  });

  it('returns a presigned preview URL for a photo owned by this store', async () => {
    const owner = await seedOwner(100);
    const store = await seedStore(owner.id);
    const r2Key = await uploadCustomerPhoto(store.storeKey, Buffer.from('photo-bytes'));

    const res = await app.inject({
      method: 'POST',
      url: '/v1/shopify/customer/photo/preview',
      headers: { 'x-widget-key': store.storeKey },
      payload: { r2Key },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { previewUrl: string };
    expect(body.previewUrl).toContain(r2Key);
  });

  it('rejects a preview request for a photo belonging to a different store', async () => {
    const store = await seedStore(null);
    const otherStore = await seedStore(null);
    const r2Key = await uploadCustomerPhoto(otherStore.storeKey, Buffer.from('photo-bytes'));

    const res = await app.inject({
      method: 'POST',
      url: '/v1/shopify/customer/photo/preview',
      headers: { 'x-widget-key': store.storeKey },
      payload: { r2Key },
    });
    expect(res.statusCode).toBe(404);
  });

  it('rejects a preview request once the ownership marker has expired', async () => {
    const store = await seedStore(null);
    const r2Key = await uploadCustomerPhoto(store.storeKey, Buffer.from('photo-bytes'));
    await app.redis.del(`shopify:upload:${r2Key}`);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/shopify/customer/photo/preview',
      headers: { 'x-widget-key': store.storeKey },
      payload: { r2Key },
    });
    expect(res.statusCode).toBe(404);
  });
});
