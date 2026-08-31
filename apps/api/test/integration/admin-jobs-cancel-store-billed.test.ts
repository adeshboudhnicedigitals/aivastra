import { schema } from '@aivastra/db';
import { and, eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminAuthHeader } from '../helpers/admin.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

// Shopify jobs carry no user_id — they bill shopify_store_credits via
// shopify_store_id. Both admin cancellation routes refunded only through the
// user ledger, so a cancelled store-billed job left the merchant paying for a
// generation that never ran.
describe('admin job cancellation — store-billed jobs', () => {
  let c: Containers;
  let app: TestApp;
  let adminAuth: Record<string, string>;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
    adminAuth = await adminAuthHeader(app, 'SUPER_ADMIN');
  }, 90_000);

  afterAll(async () => {
    await app.close();
    await c.stop();
  });

  async function seedStoreJob(opts: { balance: number; charged: number; status: string }) {
    const nonce = crypto.randomUUID();
    const [store] = await app.db
      .insert(schema.shopifyStores)
      .values({
        shopDomain: `cancel-${nonce}.myshopify.com`,
        shopifyShopId: Math.floor(Math.random() * 1_000_000_000),
        accessToken: 'enc',
        scope: 'read_products',
      })
      .returning({ id: schema.shopifyStores.id });
    await app.db
      .insert(schema.shopifyStoreCredits)
      .values({ storeId: store.id, balance: opts.balance });

    // biome-ignore lint/suspicious/noExplicitAny: Drizzle infers non-null for nullable FKs
    const [job] = await (app.db.insert(schema.jobs).values as any)({
      shopifyStoreId: store.id,
      status: opts.status,
      source: 'shopify',
      creditsCharged: opts.charged,
    }).returning();

    return { storeId: store.id as string, jobId: job.id as string };
  }

  function balanceOf(storeId: string) {
    return app.db
      .select({ balance: schema.shopifyStoreCredits.balance })
      .from(schema.shopifyStoreCredits)
      .where(eq(schema.shopifyStoreCredits.storeId, storeId))
      .then(([r]) => r?.balance);
  }

  function statusOf(jobId: string) {
    return app.db
      .select({ status: schema.jobs.status })
      .from(schema.jobs)
      .where(eq(schema.jobs.id, jobId))
      .then(([r]) => r?.status);
  }

  function refundRows(jobId: string) {
    return app.db
      .select()
      .from(schema.shopifyCreditLedger)
      .where(
        and(
          eq(schema.shopifyCreditLedger.jobId, jobId),
          eq(schema.shopifyCreditLedger.reason, 'REFUND_ADMIN_CANCEL'),
        ),
      );
  }

  it('POST /admin/jobs/:id/cancel refunds the store', async () => {
    const { storeId, jobId } = await seedStoreJob({
      balance: 10,
      charged: 3,
      status: 'QUEUED',
    });

    const res = await app.inject({
      method: 'POST',
      url: `/admin/jobs/${jobId}/cancel`,
      headers: adminAuth,
    });
    expect(res.statusCode).toBe(200);

    expect(await statusOf(jobId)).toBe('CANCELLED');
    expect(await balanceOf(storeId)).toBe(13);
    expect(await refundRows(jobId)).toHaveLength(1);
  });

  it('cancels a mid-flight store-billed job and refunds it', async () => {
    const { storeId, jobId } = await seedStoreJob({
      balance: 0,
      charged: 2,
      status: 'GENERATING',
    });

    await app.inject({
      method: 'POST',
      url: `/admin/jobs/${jobId}/cancel`,
      headers: adminAuth,
    });

    expect(await statusOf(jobId)).toBe('CANCELLED');
    expect(await balanceOf(storeId)).toBe(2);
  });

  it('does not refund twice when cancel is replayed', async () => {
    const { storeId, jobId } = await seedStoreJob({
      balance: 5,
      charged: 4,
      status: 'QUEUED',
    });

    for (let i = 0; i < 3; i++) {
      await app.inject({
        method: 'POST',
        url: `/admin/jobs/${jobId}/cancel`,
        headers: adminAuth,
      });
    }

    expect(await balanceOf(storeId)).toBe(9);
    expect(await refundRows(jobId)).toHaveLength(1);
  });

  it('publishes CANCELLED on the store SSE channel the widget listens to', async () => {
    const { storeId, jobId } = await seedStoreJob({
      balance: 0,
      charged: 1,
      status: 'GENERATING',
    });

    const sub = new Redis(c.redisUrl);
    const received: string[] = [];
    await sub.subscribe(`sse:events:store:${storeId}`);
    sub.on('message', (_ch, msg) => received.push(msg));

    await app.inject({
      method: 'POST',
      url: `/admin/jobs/${jobId}/cancel`,
      headers: adminAuth,
    });
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(received).toHaveLength(1);
    const evt = JSON.parse(received[0] as string);
    expect(evt).toMatchObject({ jobId, type: 'STATUS', status: 'CANCELLED' });

    await sub.unsubscribe(`sse:events:store:${storeId}`);
    sub.disconnect();
  });

  it('does not announce a cancel it did not make', async () => {
    const { storeId, jobId } = await seedStoreJob({
      balance: 0,
      charged: 1,
      status: 'COMPLETED',
    });

    const sub = new Redis(c.redisUrl);
    const received: string[] = [];
    await sub.subscribe(`sse:events:store:${storeId}`);
    sub.on('message', (_ch, msg) => received.push(msg));

    await app.inject({
      method: 'POST',
      url: `/admin/jobs/${jobId}/cancel`,
      headers: adminAuth,
    });
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(received).toHaveLength(0);

    await sub.unsubscribe(`sse:events:store:${storeId}`);
    sub.disconnect();
  });

  it('leaves an already-COMPLETED store job alone', async () => {
    const { storeId, jobId } = await seedStoreJob({
      balance: 7,
      charged: 5,
      status: 'COMPLETED',
    });

    await app.inject({
      method: 'POST',
      url: `/admin/jobs/${jobId}/cancel`,
      headers: adminAuth,
    });

    expect(await statusOf(jobId)).toBe('COMPLETED');
    expect(await balanceOf(storeId)).toBe(7);
    expect(await refundRows(jobId)).toHaveLength(0);
  });

  it('POST /admin/jobs/flush-queue refunds queued store-billed jobs', async () => {
    const a = await seedStoreJob({ balance: 1, charged: 6, status: 'QUEUED' });
    const b = await seedStoreJob({ balance: 0, charged: 2, status: 'QUEUED' });

    const res = await app.inject({
      method: 'POST',
      url: '/admin/jobs/flush-queue',
      headers: adminAuth,
    });
    expect(res.statusCode).toBe(200);

    expect(await statusOf(a.jobId)).toBe('CANCELLED');
    expect(await statusOf(b.jobId)).toBe('CANCELLED');
    expect(await balanceOf(a.storeId)).toBe(7);
    expect(await balanceOf(b.storeId)).toBe(2);
    expect(await refundRows(a.jobId)).toHaveLength(1);
    expect(await refundRows(b.jobId)).toHaveLength(1);
  });

  it('still refunds a user-billed job through flush-queue', async () => {
    const [user] = await app.db
      .insert(schema.users)
      .values({
        email: `flush-${crypto.randomUUID()}@x.com`,
        passwordHash: 'x',
        tier: 'free',
      })
      .returning();
    await app.db.insert(schema.userCredits).values({ userId: user.id, balance: 1 });
    const [job] = await app.db
      .insert(schema.jobs)
      .values({ userId: user.id, status: 'QUEUED', source: 'tryon', creditsCharged: 4 })
      .returning();

    await app.inject({
      method: 'POST',
      url: '/admin/jobs/flush-queue',
      headers: adminAuth,
    });

    expect(await statusOf(job.id)).toBe('CANCELLED');
    const [credits] = await app.db
      .select()
      .from(schema.userCredits)
      .where(eq(schema.userCredits.userId, user.id));
    expect(credits?.balance).toBe(5);
  });
});
