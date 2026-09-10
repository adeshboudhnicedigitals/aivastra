import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { refundStoreAndMarkCancelled } from '../../src/modules/credits/shopify-ledger.js';
import { releaseStoreDailySlot, reserveStoreDailySlot } from '../../src/modules/shopify/limits.js';
import { storeDayKey } from '../../src/modules/shopify/store-day.js';
import { buildTestApp } from '../helpers/api.js';
import { startContainers } from '../helpers/containers.js';

describe('shopify shopper limits', () => {
  let ctx: Awaited<ReturnType<typeof startContainers>>;
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  const ownerBalances = new Map<string, number>();

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
    ownerBalances.set(user.id, balance);
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
      })
      .returning();
    const balance = ownerUserId ? ownerBalances.get(ownerUserId) : undefined;
    if (balance !== undefined) {
      await app.db.insert(schema.shopifyStoreCredits).values({ storeId: store.id, balance });
    }
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
    expect(res.json().message).toMatch(/^Try-on isn't available right now\. Come back .+\.$/);

    const [credits] = await app.db
      .select()
      .from(schema.shopifyStoreCredits)
      .where(eq(schema.shopifyStoreCredits.storeId, store.id));
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
      .from(schema.shopifyStoreCredits)
      .where(eq(schema.shopifyStoreCredits.storeId, store.id));

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
      .from(schema.shopifyStoreCredits)
      .where(eq(schema.shopifyStoreCredits.storeId, store.id));
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
        .from(schema.shopifyStoreCredits)
        .where(eq(schema.shopifyStoreCredits.storeId, store.id));
      expect.soft(credits.balance).toBe(100);

      const [job] = await app.db
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.shopifyStoreId, store.id));
      expect.soft(job.status).toBe('FAILED');
      expect.soft(job.errorCode).toBe('ENQUEUE_FAIL');
      const refundRows = await app.db
        .select()
        .from(schema.shopifyCreditLedger)
        .where(
          and(
            eq(schema.shopifyCreditLedger.jobId, job.id),
            eq(schema.shopifyCreditLedger.reason, 'REFUND_ENQUEUE_FAIL'),
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

  it('does not refund or fail a job the dispatcher already completed under an ambiguous enqueue', async () => {
    // The reverse of the race the dispatcher-side test covers. XADD is
    // ambiguous on failure: the message can land server-side while the client's
    // ack is lost. The dispatcher then runs the job to COMPLETED while this
    // route is still in its error path believing the enqueue failed. Without a
    // status guard the compensation overwrites COMPLETED with FAILED and
    // refunds a generation the shopper actually received — image AND credits.
    await seedDefaultFunnelTemplate();
    const owner = await seedOwner(100);
    const store = await seedStore(owner.id);
    await seedGarment(store.id, 5010);
    const photo = await uploadCustomerPhoto(store.storeKey, Buffer.alloc(1024));

    const realXadd = app.redis.xadd.bind(app.redis);
    app.redis.xadd = (async () => {
      // Stand in for a dispatcher that already picked the job up: the message
      // really did land, we just never heard back about it.
      await app.db
        .update(schema.jobs)
        .set({ status: 'COMPLETED' })
        .where(eq(schema.jobs.shopifyStoreId, store.id));
      throw new Error('redis down');
    }) as typeof app.redis.xadd;

    try {
      const res = await createJob(store, {
        customerPhotoKey: photo,
        shopifyProductId: 5010,
        clientId: randomUUID(),
      });
      // The caller still gets the 503 — we genuinely don't know the enqueue
      // worked. That part is unchanged and correct.
      expect.soft(res.statusCode).toBe(503);
    } finally {
      app.redis.xadd = realXadd;
    }

    const [job] = await app.db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.shopifyStoreId, store.id));
    // The delivered generation is left alone.
    expect.soft(job.status).toBe('COMPLETED');
    expect.soft(job.errorCode).toBeNull();

    const refundRows = await app.db
      .select()
      .from(schema.shopifyCreditLedger)
      .where(
        and(
          eq(schema.shopifyCreditLedger.jobId, job.id),
          eq(schema.shopifyCreditLedger.reason, 'REFUND_ENQUEUE_FAIL'),
        ),
      );
    expect.soft(refundRows).toHaveLength(0);

    // Credits stay spent: the job ran, so the charge is legitimate.
    const [credits] = await app.db
      .select()
      .from(schema.shopifyStoreCredits)
      .where(eq(schema.shopifyStoreCredits.storeId, store.id));
    expect(credits.balance).toBe(95);
  });

  it('reports the skipped compensation to its caller', async () => {
    // The route logs a warning off this return value; without it the race is
    // invisible in production.
    const owner = await seedOwner(100);
    const store = await seedStore(owner.id);
    const [job] = await app.db
      .insert(schema.jobs)
      .values({
        shopifyStoreId: store.id,
        status: 'COMPLETED',
        creditsCharged: 5,
        source: 'shopify',
      })
      .returning();

    const { refundStoreAndMarkFailed } = await import(
      '../../src/modules/credits/shopify-ledger.js'
    );
    expect(
      await refundStoreAndMarkFailed(
        app.db,
        store.id,
        5,
        job.id,
        'REFUND_ENQUEUE_FAIL',
        'ENQUEUE_FAIL',
      ),
    ).toEqual({ compensated: false });

    // And a still-QUEUED job is compensated exactly as before, so the guard
    // did not turn the whole path into a no-op.
    const [queued] = await app.db
      .insert(schema.jobs)
      .values({
        shopifyStoreId: store.id,
        status: 'QUEUED',
        creditsCharged: 5,
        source: 'shopify',
      })
      .returning();
    expect(
      await refundStoreAndMarkFailed(
        app.db,
        store.id,
        5,
        queued.id,
        'REFUND_ENQUEUE_FAIL',
        'ENQUEUE_FAIL',
      ),
    ).toEqual({ compensated: true });
    const [after] = await app.db.select().from(schema.jobs).where(eq(schema.jobs.id, queued.id));
    expect(after.status).toBe('FAILED');
    const [credits] = await app.db
      .select()
      .from(schema.shopifyStoreCredits)
      .where(eq(schema.shopifyStoreCredits.storeId, store.id));
    expect(credits.balance).toBe(105);
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
        .from(schema.shopifyStoreCredits)
        .where(eq(schema.shopifyStoreCredits.storeId, store.id));
      expect.soft(credits.balance).toBe(100);

      const [job] = await app.db
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.shopifyStoreId, store.id));
      expect.soft(job.status).toBe('FAILED');
      expect.soft(job.errorCode).toBe('ENQUEUE_FAIL');

      const refundRows = await app.db
        .select()
        .from(schema.shopifyCreditLedger)
        .where(
          and(
            eq(schema.shopifyCreditLedger.jobId, job.id),
            eq(schema.shopifyCreditLedger.reason, 'REFUND_ENQUEUE_FAIL'),
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

  it('releases nothing and leaves no partial counter when the atomic reservation script itself fails', async () => {
    // Regression for finding #4 (fix round 1): the reserve, its first-use
    // EXPIRE, and the over-cap rollback DECR used to be three independent
    // Redis round trips, so a crash between any two could leave the counter
    // incremented but never expiring. They now run as one Lua script via
    // EVAL. Mocking `eval` to fail simulates the whole reservation attempt
    // never landing — proving there is no intermediate state to leak,
    // because there is no intermediate round trip left to fail on.
    await seedDefaultFunnelTemplate();
    const owner = await seedOwner(100);
    const store = await seedStore(owner.id);
    await seedGarment(store.id, 5008);
    await setLimits(store.id, { storeDailyCap: 1 });
    const counterKey = `shopify:cap:store:${store.id}:${storeDayKey(null)}`;
    const photo = await uploadCustomerPhoto(store.storeKey, Buffer.alloc(1024));

    const realEval = app.redis.eval.bind(app.redis);
    app.redis.eval = (async () => {
      throw new Error('redis reservation script failed');
    }) as typeof app.redis.eval;

    try {
      const failed = await createJob(store, {
        customerPhotoKey: photo,
        shopifyProductId: 5008,
        clientId: randomUUID(),
      });
      expect.soft(failed.statusCode).toBe(500);
      expect.soft(await app.redis.get(counterKey)).toBeNull();

      const [credits] = await app.db
        .select()
        .from(schema.shopifyStoreCredits)
        .where(eq(schema.shopifyStoreCredits.storeId, store.id));
      expect.soft(credits.balance).toBe(100);
      const jobs = await app.db
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.shopifyStoreId, store.id));
      expect.soft(jobs).toHaveLength(0);
    } finally {
      app.redis.eval = realEval;
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

    const jobId = randomUUID();
    // The release is a Lua script now, not a bare DECR — numkeys 2 is the
    // release (counter + per-job marker); the reservation script passes 1.
    const realEval = app.redis.eval.bind(app.redis);
    app.redis.eval = (async (...args: unknown[]) => {
      if (args[1] === 2) throw new Error('redis release failed');
      // biome-ignore lint/suspicious/noExplicitAny: passthrough to the real variadic signature
      return (realEval as any)(...args);
    }) as typeof app.redis.eval;
    try {
      await expect(slot.release(jobId)).rejects.toThrow('redis release failed');
    } finally {
      app.redis.eval = realEval;
    }
    // The throwing attempt must not have claimed the marker, or the real
    // release below would be swallowed as a duplicate.
    await slot.release(jobId);
    await slot.release(jobId);
    expect(await app.redis.get(counterKey)).toBe('0');
  });

  it('serializes concurrent requests from the same shopper against a per-shopper cap of 1', async () => {
    // Regression for finding #1 (fix round 1): the shopper-limit check used
    // to run exactly once, entirely before the job-creation transaction
    // opened. Two concurrent requests from the same shopper could both
    // observe capacity and both create a job, exceeding the cap.
    // lockAndRecheckShopperLimits now takes a transaction-scoped advisory
    // lock keyed on the shopper's counting identity and rechecks the limit
    // under it, immediately before the job insert — serializing the two
    // racing requests so only one can win.
    await seedDefaultFunnelTemplate();
    const owner = await seedOwner(100);
    const store = await seedStore(owner.id);
    await seedGarment(store.id, 5009);
    await setLimits(store.id, { perShopperCap: 1, perShopperWindow: 'day' });

    const clientId = randomUUID();
    const [photoA, photoB] = await Promise.all([
      uploadCustomerPhoto(store.storeKey, Buffer.alloc(1024)),
      uploadCustomerPhoto(store.storeKey, Buffer.alloc(1024)),
    ]);

    const [resA, resB] = await Promise.all([
      createJob(store, { customerPhotoKey: photoA, shopifyProductId: 5009, clientId }),
      createJob(store, { customerPhotoKey: photoB, shopifyProductId: 5009, clientId }),
    ]);

    const statuses = [resA.statusCode, resB.statusCode].sort();
    expect(statuses).toEqual([201, 202]);

    const refused = resA.statusCode === 202 ? resA : resB;
    expect(refused.json().reason).toBe('shopper_limit');

    const jobs = await app.db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.shopifyStoreId, store.id));
    expect(jobs).toHaveLength(1);

    const [credits] = await app.db
      .select()
      .from(schema.shopifyStoreCredits)
      .where(eq(schema.shopifyStoreCredits.storeId, store.id));
    expect(credits.balance).toBe(95);
  });

  it('recovers store quota via bounded route-level retries after transient release failures', async () => {
    // Regression for finding #3 (fix round 1): the route used to call
    // slot.release() exactly once. A single transient release failure
    // permanently leaked the reserved slot until the 48h key expiry. The
    // route now retries the (already-idempotent) release closure up to 3
    // times — this forces the first two release calls to fail and asserts the
    // counter is restored anyway, without the test itself retrying anything.
    await seedDefaultFunnelTemplate();
    const owner = await seedOwner(100);
    const store = await seedStore(owner.id);
    await seedGarment(store.id, 5010);
    await setLimits(store.id, { storeDailyCap: 1 });
    const counterKey = `shopify:cap:store:${store.id}:${storeDayKey(null)}`;
    const photo = await uploadCustomerPhoto(store.storeKey, Buffer.alloc(1024));

    const realXadd = app.redis.xadd.bind(app.redis);
    app.redis.xadd = (async () => {
      throw new Error('redis down');
    }) as typeof app.redis.xadd;

    const realEval = app.redis.eval.bind(app.redis);
    let releaseCalls = 0;
    app.redis.eval = (async (...args: unknown[]) => {
      if (args[1] !== 2) {
        // biome-ignore lint/suspicious/noExplicitAny: passthrough to the real variadic signature
        return (realEval as any)(...args);
      }
      releaseCalls += 1;
      if (releaseCalls <= 2) throw new Error('transient release failure');
      // biome-ignore lint/suspicious/noExplicitAny: passthrough to the real variadic signature
      return (realEval as any)(...args);
    }) as typeof app.redis.eval;

    try {
      const failed = await createJob(store, {
        customerPhotoKey: photo,
        shopifyProductId: 5010,
        clientId: randomUUID(),
      });
      expect.soft(failed.statusCode).toBe(503);
      expect.soft(releaseCalls).toBe(3);

      const [job] = await app.db
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.shopifyStoreId, store.id));
      expect.soft(job.status).toBe('FAILED');
      expect.soft(job.errorCode).toBe('ENQUEUE_FAIL');

      const [credits] = await app.db
        .select()
        .from(schema.shopifyStoreCredits)
        .where(eq(schema.shopifyStoreCredits.storeId, store.id));
      expect.soft(credits.balance).toBe(100);
    } finally {
      app.redis.xadd = realXadd;
      app.redis.eval = realEval;
    }

    // Quota recovered without the test manually retrying — the very next
    // request against the cap-of-1 store succeeds.
    const retry = await createJob(store, {
      customerPhotoKey: photo,
      shopifyProductId: 5010,
      clientId: randomUUID(),
    });
    expect(retry.statusCode).toBe(201);
    expect(await app.redis.get(counterKey)).toBe('1');
  });

  it('enforces nothing when the store settings explicitly set limits to null', async () => {
    // Compatibility test for finding #6's third bullet: an explicit
    // `limits: null` (as opposed to the key being absent entirely, already
    // covered above) must also disable enforcement.
    await seedDefaultFunnelTemplate();
    const owner = await seedOwner(100);
    const store = await seedStore(owner.id);
    await seedGarment(store.id, 5011);
    await app.db
      .update(schema.shopifyStores)
      .set({ settings: { limits: null } })
      .where(eq(schema.shopifyStores.id, store.id));

    const clientId = randomUUID();
    const photo = await uploadCustomerPhoto(store.storeKey, Buffer.alloc(1024));
    const res = await createJob(store, {
      customerPhotoKey: photo,
      shopifyProductId: 5011,
      clientId,
    });
    expect(res.statusCode).toBe(201);
  });
  // ── Gap 4: a failed try-on must stop consuming the merchant's daily cap ──
  //
  // The cap is a merchant-configured ceiling on their own spend ("once this
  // many try-ons have run today"). A generation that failed did not run and is
  // refunded, so keeping its slot charged the merchant nothing and still ended
  // their day early. It also left the store cap disagreeing with the
  // per-shopper cap, which has always excluded FAILED jobs.

  it('pins the cap key onto the job so a later failure can find it', async () => {
    await seedDefaultFunnelTemplate();
    const owner = await seedOwner(100);
    const store = await seedStore(owner.id);
    await seedGarment(store.id, 5310);
    await setLimits(store.id, { storeDailyCap: 5 });
    const photo = await uploadCustomerPhoto(store.storeKey, Buffer.alloc(1024));

    const res = await createJob(store, {
      customerPhotoKey: photo,
      shopifyProductId: 5310,
      clientId: randomUUID(),
    });
    expect(res.statusCode).toBe(201);

    const [inputs] = await app.db
      .select()
      .from(schema.jobInputs)
      .where(eq(schema.jobInputs.jobId, JSON.parse(res.body).jobId));
    // Recorded at creation, not recomputed later: a job created at 23:59 and
    // failed at 00:01 has to give its slot back to the day it was created.
    expect((inputs.params as { storeCapKey?: string }).storeCapKey).toBe(
      `shopify:cap:store:${store.id}:${storeDayKey(null)}`,
    );
  });

  it('records no cap key when the store is uncapped', async () => {
    await seedDefaultFunnelTemplate();
    const owner = await seedOwner(100);
    const store = await seedStore(owner.id);
    await seedGarment(store.id, 5311);
    await setLimits(store.id, { perShopperCap: 5 });
    const photo = await uploadCustomerPhoto(store.storeKey, Buffer.alloc(1024));

    const res = await createJob(store, {
      customerPhotoKey: photo,
      shopifyProductId: 5311,
      clientId: randomUUID(),
    });
    expect(res.statusCode).toBe(201);

    const [inputs] = await app.db
      .select()
      .from(schema.jobInputs)
      .where(eq(schema.jobInputs.jobId, JSON.parse(res.body).jobId));
    expect((inputs.params as { storeCapKey?: string | null }).storeCapKey).toBeNull();
  });

  it('releases a slot exactly once per job, however many times it is asked', async () => {
    const owner = await seedOwner(100);
    const store = await seedStore(owner.id);
    await setLimits(store.id, { storeDailyCap: 3 });
    const [configured] = await app.db
      .select()
      .from(schema.shopifyStores)
      .where(eq(schema.shopifyStores.id, store.id));
    const counterKey = `shopify:cap:store:${store.id}:${storeDayKey(null)}`;

    const a = await reserveStoreDailySlot(app, configured);
    const b = await reserveStoreDailySlot(app, configured);
    if (!a.ok || !b.ok) throw new Error('expected reserved slots');
    expect(await app.redis.get(counterKey)).toBe('2');

    const jobA = randomUUID();
    // A redelivered stream message, a sweeper racing the processor, and an
    // admin cancel racing a GPU failure can all drive this for one job.
    expect(await releaseStoreDailySlot(app.redis, counterKey, jobA)).toBe(true);
    expect(await releaseStoreDailySlot(app.redis, counterKey, jobA)).toBe(false);
    expect(await releaseStoreDailySlot(app.redis, counterKey, jobA)).toBe(false);
    expect(await app.redis.get(counterKey)).toBe('1');

    // A different job releases its own slot independently.
    expect(await releaseStoreDailySlot(app.redis, counterKey, randomUUID())).toBe(true);
    expect(await app.redis.get(counterKey)).toBe('0');
  });

  it('never drives the counter negative once the day key has expired', async () => {
    const store = await seedStore(null);
    const counterKey = `shopify:cap:store:${store.id}:${storeDayKey(null)}`;
    await app.redis.del(counterKey);

    // DECR on a missing key would create it at -1, which hands the next
    // store-day free slots on top of its cap.
    expect(await releaseStoreDailySlot(app.redis, counterKey, randomUUID())).toBe(false);
    expect(await app.redis.get(counterKey)).toBeNull();

    await app.redis.set(counterKey, '0');
    expect(await releaseStoreDailySlot(app.redis, counterKey, randomUUID())).toBe(false);
    expect(await app.redis.get(counterKey)).toBe('0');
  });

  it('gives the slot back when an admin cancels a store-billed job', async () => {
    await seedDefaultFunnelTemplate();
    const owner = await seedOwner(100);
    const store = await seedStore(owner.id);
    await seedGarment(store.id, 5312);
    await setLimits(store.id, { storeDailyCap: 1 });
    const counterKey = `shopify:cap:store:${store.id}:${storeDayKey(null)}`;
    const photo = await uploadCustomerPhoto(store.storeKey, Buffer.alloc(1024));

    const res = await createJob(store, {
      customerPhotoKey: photo,
      shopifyProductId: 5312,
      clientId: randomUUID(),
    });
    expect(res.statusCode).toBe(201);
    expect(await app.redis.get(counterKey)).toBe('1');

    const jobId = JSON.parse(res.body).jobId as string;
    const [inputs] = await app.db
      .select()
      .from(schema.jobInputs)
      .where(eq(schema.jobInputs.jobId, jobId));
    const capKey = (inputs.params as { storeCapKey: string }).storeCapKey;

    // Stands in for the admin cancel route's own compensation step.
    await refundStoreAndMarkCancelled(
      app.db,
      store.id,
      1,
      jobId,
      'REFUND_ADMIN_CANCEL',
      'ADMIN_CANCEL',
    );
    await releaseStoreDailySlot(app.redis, capKey, jobId);

    expect(await app.redis.get(counterKey)).toBe('0');

    // The whole point: the merchant's cap-of-1 store can serve another shopper
    // instead of being dark for the rest of the day over a try-on that never ran.
    const retry = await createJob(store, {
      customerPhotoKey: photo,
      shopifyProductId: 5312,
      clientId: randomUUID(),
    });
    expect(retry.statusCode).toBe(201);
  });
});
