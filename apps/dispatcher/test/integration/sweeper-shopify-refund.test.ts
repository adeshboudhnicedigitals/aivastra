import { schema } from '@aivastra/db';
import { createLogger } from '@aivastra/logger';
import { and, eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runSweeper } from '../../src/stream/sweeper.js';
import { setupTestEnv, type TestEnv } from '../helpers/containers.js';

// A Shopify job carries neither user_id nor merchant_id — it is billed to
// shopify_store_credits via shopify_store_id. The sweeper is the only thing
// that terminates a job whose dispatcher died mid-flight, so if it doesn't
// know about that third billing owner the merchant pays for a job that never
// produced an image.
describe('runSweeper — stuck Shopify jobs', () => {
  let env: TestEnv;
  let redis: Redis;
  let pub: Redis;
  let sub: Redis;
  const log = createLogger('dispatcher-test');

  // Older than IN_FLIGHT_SLA_MS (15m) so the sweeper actually claims the row.
  const STUCK_AT = new Date(Date.now() - 20 * 60 * 1000);

  beforeAll(async () => {
    env = await setupTestEnv();
    redis = new Redis('redis://127.0.0.1:6379');
    pub = new Redis('redis://127.0.0.1:6379');
    sub = new Redis('redis://127.0.0.1:6379');
  }, 60_000);

  afterAll(async () => {
    redis.disconnect();
    pub.disconnect();
    sub.disconnect();
    await env.cleanup();
  });

  async function seedStuckShopifyJob(opts: {
    balance: number;
    creditsCharged: number;
    capKey?: string;
  }) {
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const [store] = await env.db
      .insert(schema.shopifyStores)
      .values({
        shopDomain: `sweeper-${unique}.myshopify.com`,
        shopifyShopId: Date.now() + Math.floor(Math.random() * 1000),
        accessToken: 'iv:tag:enc',
        scope: 'read_products',
      })
      .returning();

    await env.db
      .insert(schema.shopifyStoreCredits)
      .values({ storeId: store.id, balance: opts.balance });

    // biome-ignore lint/suspicious/noExplicitAny: Drizzle infers non-null for nullable FKs — matches the insert in customer.routes.ts
    const [job] = await (env.db.insert(schema.jobs).values as any)({
      shopifyStoreId: store.id,
      status: 'GENERATING',
      source: 'shopify',
      creditsCharged: opts.creditsCharged,
      customerPhotoKey: `widget-inputs/${store.id}/photo.jpg`,
      createdAt: STUCK_AT,
      startedAt: STUCK_AT,
    }).returning();

    if (opts.capKey !== undefined) {
      // Mirrors what the API pins onto the job at creation.
      // biome-ignore lint/suspicious/noExplicitAny: Drizzle infers non-null for nullable FKs
      await (env.db.insert(schema.jobInputs).values as any)({
        jobId: job.id,
        upperGarmentKey: `widget-inputs/${store.id}/garment.jpg`,
        params: { kind: 'shopify', storeCapKey: opts.capKey },
      });
    }

    return { storeId: store.id as string, jobId: job.id as string };
  }

  function storeBalance(storeId: string) {
    return env.db
      .select({ balance: schema.shopifyStoreCredits.balance })
      .from(schema.shopifyStoreCredits)
      .where(eq(schema.shopifyStoreCredits.storeId, storeId))
      .then(([r]) => r?.balance);
  }

  it('refunds the store and marks the job FAILED', async () => {
    const { storeId, jobId } = await seedStuckShopifyJob({ balance: 10, creditsCharged: 2 });

    await runSweeper(env.db, redis, pub, log);

    const [job] = await env.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    expect(job?.status).toBe('FAILED');
    expect(job?.errorCode).toBe('STUCK_IN_FLIGHT');

    expect(await storeBalance(storeId)).toBe(12);

    const ledger = await env.db
      .select()
      .from(schema.shopifyCreditLedger)
      .where(
        and(
          eq(schema.shopifyCreditLedger.jobId, jobId),
          eq(schema.shopifyCreditLedger.reason, 'JOB_FAIL_REFUND'),
        ),
      );
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.delta).toBe(2);
  });

  it('publishes the FAILED event on the store SSE channel, not an empty one', async () => {
    const { storeId, jobId } = await seedStuckShopifyJob({ balance: 0, creditsCharged: 1 });

    const received: string[] = [];
    await sub.subscribe(`sse:events:store:${storeId}`);
    sub.on('message', (_channel, message) => received.push(message));

    await runSweeper(env.db, redis, pub, log);
    // The publish is fire-and-forget relative to the subscriber; give the
    // message a moment to land rather than racing the assertion.
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(received).toHaveLength(1);
    const evt = JSON.parse(received[0] as string);
    expect(evt.jobId).toBe(jobId);
    expect(evt.status).toBe('FAILED');

    await sub.unsubscribe(`sse:events:store:${storeId}`);
  });

  it('refunds exactly once across two sweeps', async () => {
    const { storeId, jobId } = await seedStuckShopifyJob({ balance: 5, creditsCharged: 3 });

    await runSweeper(env.db, redis, pub, log);
    // The first sweep moves the job to FAILED, which drops it out of
    // IN_FLIGHT_STATES — so re-run the refund against a row forced back
    // in-flight, proving the ledger guard (not the status filter) is what
    // stops the double credit.
    await env.db
      .update(schema.jobs)
      .set({ status: 'GENERATING', startedAt: STUCK_AT, createdAt: STUCK_AT })
      .where(eq(schema.jobs.id, jobId));
    await runSweeper(env.db, redis, pub, log);

    expect(await storeBalance(storeId)).toBe(8);

    const ledger = await env.db
      .select()
      .from(schema.shopifyCreditLedger)
      .where(
        and(
          eq(schema.shopifyCreditLedger.jobId, jobId),
          eq(schema.shopifyCreditLedger.reason, 'JOB_FAIL_REFUND'),
        ),
      );
    expect(ledger).toHaveLength(1);
  });

  it('still refunds a normal user-billed job through the same sweep', async () => {
    const [user] = await env.db
      .insert(schema.users)
      .values({
        email: `sweep-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@x.com`,
        passwordHash: 'x',
        tier: 'free',
      })
      .returning();
    await env.db.insert(schema.userCredits).values({ userId: user.id, balance: 4 });

    const [job] = await env.db
      .insert(schema.jobs)
      .values({
        userId: user.id,
        status: 'GENERATING',
        source: 'tryon',
        creditsCharged: 6,
        createdAt: STUCK_AT,
        startedAt: STUCK_AT,
      })
      .returning();

    await runSweeper(env.db, redis, pub, log);

    const [after] = await env.db
      .select()
      .from(schema.userCredits)
      .where(eq(schema.userCredits.userId, user.id));
    expect(after?.balance).toBe(10);

    const [swept] = await env.db.select().from(schema.jobs).where(eq(schema.jobs.id, job.id));
    expect(swept?.status).toBe('FAILED');
  });
  // ── Gap 4 ───────────────────────────────────────────────────────────────
  // The store daily cap is a merchant-configured ceiling on their own spend.
  // A swept job never ran and its credits are refunded, so it must stop
  // counting against that ceiling — otherwise a worker outage silently ends
  // the store's day while charging them nothing.

  it('gives the store daily cap slot back when it sweeps a job', async () => {
    const capKey = `shopify:cap:store:sweep-${Date.now()}:2026-08-31`;
    await redis.set(capKey, '3');
    const { jobId } = await seedStuckShopifyJob({
      balance: 0,
      creditsCharged: 1,
      capKey,
    });

    await runSweeper(env.db, redis, pub, log);

    expect(await redis.get(capKey)).toBe('2');
    expect(await redis.get(`shopify:cap:released:${jobId}`)).toBe('1');
    await redis.del(capKey, `shopify:cap:released:${jobId}`);
  });

  it('releases the slot only once even if the job is swept twice', async () => {
    const capKey = `shopify:cap:store:sweep2-${Date.now()}:2026-08-31`;
    await redis.set(capKey, '3');
    const { jobId } = await seedStuckShopifyJob({
      balance: 0,
      creditsCharged: 1,
      capKey,
    });

    await runSweeper(env.db, redis, pub, log);
    // Re-open the job so a second sweep genuinely reaches the same code path,
    // standing in for a sweeper racing the processor over one job.
    await env.db.update(schema.jobs).set({ status: 'GENERATING' }).where(eq(schema.jobs.id, jobId));
    await runSweeper(env.db, redis, pub, log);

    expect(await redis.get(capKey)).toBe('2');
    await redis.del(capKey, `shopify:cap:released:${jobId}`);
  });

  it('still refunds and fails a job that has no cap key pinned', async () => {
    // Uncapped store, or a job created before the key was recorded. Losing the
    // slot is acceptable; losing the refund is not.
    const { storeId, jobId } = await seedStuckShopifyJob({ balance: 4, creditsCharged: 2 });

    await runSweeper(env.db, redis, pub, log);

    const [job] = await env.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    expect(job?.status).toBe('FAILED');
    expect(await storeBalance(storeId)).toBe(6);
  });
});
