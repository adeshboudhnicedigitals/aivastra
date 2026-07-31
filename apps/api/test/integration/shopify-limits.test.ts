import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { reserveStoreDailySlot } from '../../src/modules/shopify/limits.js';
import { storeDayKey } from '../../src/modules/shopify/store-day.js';
import { buildTestApp } from '../helpers/api.js';
import { startContainers } from '../helpers/containers.js';

describe('shopify shopper limits', () => {
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

  /** The single default funnel template every product now resolves. Created
   *  lazily so the test that asserts the no-default path isn't forced to depend
   *  on it — that test runs against a database where this was never called. */
  let defaultFunnelTemplateId: string | null = null;
  async function seedDefaultFunnelTemplate() {
    if (defaultFunnelTemplateId) return defaultFunnelTemplateId;
    const [workflow] = await app.db
      .insert(schema.workflowTemplates)
      .values({
        slug: `shopify-tryon-${Date.now()}`,
        label: 'Shopify try-on test workflow',
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
    const [funnel] = await app.db
      .insert(schema.shopifyFunnelTemplates)
      .values({
        slug: `default-${Date.now()}`,
        label: 'Default',
        workflowTemplateId: workflow.id,
        isDefault: true,
      })
      .returning();
    defaultFunnelTemplateId = funnel.id;
    return defaultFunnelTemplateId;
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

  async function setLimits(storeId: string, limits: Record<string, unknown>) {
    const [row] = await app.db
      .select()
      .from(schema.shopifyStores)
      .where(eq(schema.shopifyStores.id, storeId));
    await app.db
      .update(schema.shopifyStores)
      .set({ settings: { ...row.settings, limits } })
      .where(eq(schema.shopifyStores.id, storeId));
  }

  async function createJob(store: { storeKey: string }, body: Record<string, unknown>) {
    return app.inject({
      method: 'POST',
      url: '/v1/shopify/customer/jobs',
      headers: { 'x-widget-key': store.storeKey },
      payload: body,
    });
  }

  it('enforces the store daily cap without a client ID and charges nothing for the refusal', async () => {
    await seedDefaultFunnelTemplate();
    const owner = await seedOwner(100);
    const store = await seedStore(owner.id);
    await seedGarment(store.id, 5001);
    await setLimits(store.id, { storeDailyCap: 50 });
    const dayKey = storeDayKey(null);
    const counterKey = `shopify:cap:store:${store.id}:${dayKey}`;
    await app.redis.set(counterKey, '50');

    const photo = await uploadCustomerPhoto(store.storeKey, Buffer.alloc(1024));
    const res = await createJob(store, {
      customerPhotoKey: photo,
      shopifyProductId: 5001,
    });

    expect(res.statusCode).toBe(202);
    expect(res.json().reason).toBe('store_limit');
    expect(res.json().message).toBe("Try-on isn't available right now.");

    const [credits] = await app.db
      .select()
      .from(schema.userCredits)
      .where(eq(schema.userCredits.userId, owner.id));
    expect(credits.balance).toBe(100);
    expect(await app.redis.get(counterKey)).toBe('50');

    const jobs = await app.db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.shopifyStoreId, store.id));
    expect(jobs).toHaveLength(0);
  });

  it('enforces the per-shopper cap after a browser change with the same email', async () => {
    await seedDefaultFunnelTemplate();
    const owner = await seedOwner(100);
    const store = await seedStore(owner.id);
    await seedGarment(store.id, 5002);
    await setLimits(store.id, { perShopperCap: 1, perShopperWindow: 'day' });

    const photo1 = await uploadCustomerPhoto(store.storeKey, Buffer.alloc(1024));
    const first = await createJob(store, {
      customerPhotoKey: photo1,
      shopifyProductId: 5002,
      clientId: randomUUID(),
      email: 'shopper@example.com',
    });
    expect(first.statusCode).toBe(201);

    const [balanceAfterFirst] = await app.db
      .select()
      .from(schema.userCredits)
      .where(eq(schema.userCredits.userId, owner.id));

    const photo2 = await uploadCustomerPhoto(store.storeKey, Buffer.alloc(1024));
    const second = await createJob(store, {
      customerPhotoKey: photo2,
      shopifyProductId: 5002,
      clientId: randomUUID(),
      email: 'Shopper@Example.com',
    });
    expect(second.statusCode).toBe(202);
    expect(second.json().reason).toBe('shopper_limit');

    const [balanceAfterRefusal] = await app.db
      .select()
      .from(schema.userCredits)
      .where(eq(schema.userCredits.userId, owner.id));
    expect(balanceAfterRefusal.balance).toBe(balanceAfterFirst.balance);
  });

  it('gates on email after N try-ons, then accepts the retry with the same photo', async () => {
    await seedDefaultFunnelTemplate();
    const owner = await seedOwner(100);
    const store = await seedStore(owner.id);
    await seedGarment(store.id, 5003);
    await setLimits(store.id, { emailAfterNTryOns: 1 });

    const clientId = randomUUID();
    const photo1 = await uploadCustomerPhoto(store.storeKey, Buffer.alloc(1024));
    expect(
      (await createJob(store, { customerPhotoKey: photo1, shopifyProductId: 5003, clientId }))
        .statusCode,
    ).toBe(201);

    const photo2 = await uploadCustomerPhoto(store.storeKey, Buffer.alloc(1024));
    const gated = await createJob(store, {
      customerPhotoKey: photo2,
      shopifyProductId: 5003,
      clientId,
    });
    expect(gated.statusCode).toBe(202);
    expect(gated.json().reason).toBe('email_required');

    const retry = await createJob(store, {
      customerPhotoKey: photo2,
      shopifyProductId: 5003,
      clientId,
      email: 'gated@example.com',
      emailConsent: true,
    });
    expect(retry.statusCode).toBe(201);

    const [shopper] = await app.db
      .select()
      .from(schema.shopifyShoppers)
      .where(eq(schema.shopifyShoppers.clientId, clientId));
    expect(shopper.email).toBe('gated@example.com');
    expect(shopper.emailConsent).toBe(true);
  });

  it('links the created job to the shopper row', async () => {
    await seedDefaultFunnelTemplate();
    const owner = await seedOwner(100);
    const store = await seedStore(owner.id);
    await seedGarment(store.id, 5004);
    const clientId = randomUUID();
    const photo = await uploadCustomerPhoto(store.storeKey, Buffer.alloc(1024));
    const res = await createJob(store, {
      customerPhotoKey: photo,
      shopifyProductId: 5004,
      clientId,
    });
    expect(res.statusCode).toBe(201);
    const [job] = await app.db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.id, res.json().jobId));
    expect(job.shopifyShopperId).not.toBeNull();
  });

  it('enforces nothing when the merchant has configured no limits', async () => {
    await seedDefaultFunnelTemplate();
    const owner = await seedOwner(100);
    const store = await seedStore(owner.id);
    await seedGarment(store.id, 5005);
    const clientId = randomUUID();
    for (let i = 0; i < 3; i++) {
      const photo = await uploadCustomerPhoto(store.storeKey, Buffer.alloc(1024));
      const res = await createJob(store, {
        customerPhotoKey: photo,
        shopifyProductId: 5005,
        clientId,
      });
      expect(res.statusCode).toBe(201);
    }
  });

  it('restores store, shopper, and billing quota when enqueue fails', async () => {
    await seedDefaultFunnelTemplate();
    const owner = await seedOwner(100);
    const store = await seedStore(owner.id);
    await seedGarment(store.id, 5006);
    await setLimits(store.id, {
      storeDailyCap: 1,
      perShopperCap: 1,
      perShopperWindow: 'day',
    });
    const counterKey = `shopify:cap:store:${store.id}:${storeDayKey(null)}`;
    const photo = await uploadCustomerPhoto(store.storeKey, Buffer.alloc(1024));
    const clientId = randomUUID();

    const realXadd = app.redis.xadd.bind(app.redis);
    app.redis.xadd = (async () => {
      throw new Error('redis down');
    }) as typeof app.redis.xadd;

    try {
      const failed = await createJob(store, {
        customerPhotoKey: photo,
        shopifyProductId: 5006,
        clientId,
      });
      expect.soft(failed.statusCode).toBe(503);

      expect.soft(await app.redis.get(counterKey)).toBe('0');
      const [credits] = await app.db
        .select()
        .from(schema.userCredits)
        .where(eq(schema.userCredits.userId, owner.id));
      expect.soft(credits.balance).toBe(100);

      const [job] = await app.db
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.shopifyStoreId, store.id));
      expect.soft(job.status).toBe('FAILED');
      expect.soft(job.errorCode).toBe('ENQUEUE_FAIL');
      const refundRows = await app.db
        .select()
        .from(schema.creditLedger)
        .where(
          and(
            eq(schema.creditLedger.jobId, job.id),
            eq(schema.creditLedger.reason, 'REFUND_ENQUEUE_FAIL'),
          ),
        );
      expect.soft(refundRows).toHaveLength(1);
      expect.soft(refundRows[0]?.delta).toBe(5);
    } finally {
      app.redis.xadd = realXadd;
    }

    const retry = await createJob(store, {
      customerPhotoKey: photo,
      shopifyProductId: 5006,
      clientId,
    });
    expect(retry.statusCode).toBe(201);
    expect(await app.redis.get(counterKey)).toBe('1');
  });

  it('releases quota and compensates billing when the post-commit upload marker write fails', async () => {
    await seedDefaultFunnelTemplate();
    const owner = await seedOwner(100);
    const store = await seedStore(owner.id);
    await seedGarment(store.id, 5007);
    await setLimits(store.id, { storeDailyCap: 1 });
    const counterKey = `shopify:cap:store:${store.id}:${storeDayKey(null)}`;
    const photo = await uploadCustomerPhoto(store.storeKey, Buffer.alloc(1024));

    const realSet = app.redis.set.bind(app.redis);
    app.redis.set = (async () => {
      throw new Error('redis write failed');
    }) as typeof app.redis.set;

    try {
      const failed = await createJob(store, {
        customerPhotoKey: photo,
        shopifyProductId: 5007,
        clientId: randomUUID(),
      });
      expect.soft(failed.statusCode).toBe(503);
      expect.soft(await app.redis.get(counterKey)).toBe('0');

      const [credits] = await app.db
        .select()
        .from(schema.userCredits)
        .where(eq(schema.userCredits.userId, owner.id));
      expect.soft(credits.balance).toBe(100);

      const [job] = await app.db
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.shopifyStoreId, store.id));
      expect.soft(job.status).toBe('FAILED');
      expect.soft(job.errorCode).toBe('ENQUEUE_FAIL');

      const refundRows = await app.db
        .select()
        .from(schema.creditLedger)
        .where(
          and(
            eq(schema.creditLedger.jobId, job.id),
            eq(schema.creditLedger.reason, 'REFUND_ENQUEUE_FAIL'),
          ),
        );
      expect.soft(refundRows).toHaveLength(1);
      expect.soft(refundRows[0]?.delta).toBe(5);
    } finally {
      app.redis.set = realSet;
    }

    const retry = await createJob(store, {
      customerPhotoKey: photo,
      shopifyProductId: 5007,
      clientId: randomUUID(),
    });
    expect(retry.statusCode).toBe(201);
    expect(await app.redis.get(counterKey)).toBe('1');
  });

  it('releases the newly reserved slot when setting its expiry fails before billing', async () => {
    await seedDefaultFunnelTemplate();
    const owner = await seedOwner(100);
    const store = await seedStore(owner.id);
    await seedGarment(store.id, 5008);
    await setLimits(store.id, { storeDailyCap: 1 });
    const counterKey = `shopify:cap:store:${store.id}:${storeDayKey(null)}`;
    const photo = await uploadCustomerPhoto(store.storeKey, Buffer.alloc(1024));

    const realExpire = app.redis.expire.bind(app.redis);
    app.redis.expire = (async () => {
      throw new Error('redis expiry failed');
    }) as typeof app.redis.expire;

    try {
      const failed = await createJob(store, {
        customerPhotoKey: photo,
        shopifyProductId: 5008,
        clientId: randomUUID(),
      });
      expect.soft(failed.statusCode).toBe(500);
      expect.soft(await app.redis.get(counterKey)).toBe('0');

      const [credits] = await app.db
        .select()
        .from(schema.userCredits)
        .where(eq(schema.userCredits.userId, owner.id));
      expect.soft(credits.balance).toBe(100);
      const jobs = await app.db
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.shopifyStoreId, store.id));
      expect.soft(jobs).toHaveLength(0);
    } finally {
      app.redis.expire = realExpire;
    }

    const retry = await createJob(store, {
      customerPhotoKey: photo,
      shopifyProductId: 5008,
      clientId: randomUUID(),
    });
    expect(retry.statusCode).toBe(201);
    expect(await app.redis.get(counterKey)).toBe('1');
  });

  it('retries a failed slot release and remains idempotent after it succeeds', async () => {
    const owner = await seedOwner(100);
    const store = await seedStore(owner.id);
    await setLimits(store.id, { storeDailyCap: 1 });
    const [configuredStore] = await app.db
      .select()
      .from(schema.shopifyStores)
      .where(eq(schema.shopifyStores.id, store.id));
    const counterKey = `shopify:cap:store:${store.id}:${storeDayKey(null)}`;
    const slot = await reserveStoreDailySlot(app, configuredStore);
    expect(slot.ok).toBe(true);
    if (!slot.ok) throw new Error('expected a reserved slot');

    const realDecr = app.redis.decr.bind(app.redis);
    app.redis.decr = (async () => {
      throw new Error('redis decrement failed');
    }) as typeof app.redis.decr;
    try {
      await expect(slot.release()).rejects.toThrow('redis decrement failed');
    } finally {
      app.redis.decr = realDecr;
    }

    await slot.release();
    await slot.release();
    expect(await app.redis.get(counterKey)).toBe('0');
  });
});
