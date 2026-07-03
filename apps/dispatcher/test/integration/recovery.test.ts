import { schema } from '@aivastra/db';
import { createLogger } from '@aivastra/logger';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { recoverPendingJobs } from '../../src/stream/recovery.js';
import { deregisterWorker, registerWorkers } from '../../src/worker/registry.js';
import { type ComfyMock, startComfyMock } from '../helpers/comfy-mock.js';
import { setupTestEnv, type TestEnv } from '../helpers/containers.js';

const WORKER_ID = 'test-worker-recovery';
// Use a unique stream per test file to avoid cross-test interference
const STREAM = `jobs:recovery-test-${Date.now()}`;
const GROUP = 'dispatcher-cg';

describe('dispatcher crash recovery', () => {
  let env: TestEnv;
  let redis: Redis;
  let pub: Redis;
  let comfy: ComfyMock;

  beforeAll(async () => {
    env = await setupTestEnv();
    redis = new Redis('redis://127.0.0.1:6379');
    pub = new Redis('redis://127.0.0.1:6379');
    comfy = await startComfyMock();

    await registerWorkers(redis, [{ id: WORKER_ID, url: comfy.url, apiKey: 'test-key' }]);
    await redis.setex(`worker:health:${WORKER_ID}`, 30, '1');

    // Create consumer group on our isolated test stream
    try {
      await redis.xgroup('CREATE', STREAM, GROUP, '$', 'MKSTREAM');
    } catch (err: unknown) {
      if (!(err instanceof Error) || !err.message.includes('BUSYGROUP')) throw err;
    }
  }, 60_000);

  afterAll(async () => {
    await deregisterWorker(redis, WORKER_ID);
    await redis.del(STREAM);
    await comfy.close();
    redis.disconnect();
    pub.disconnect();
    await env.cleanup();
  });

  it('claims stale XPENDING entry and processes job to COMPLETED', async () => {
    // Seed a job in DB
    const [user] = await env.db
      .insert(schema.users)
      .values({ email: `rec-${Date.now()}@test.com`, passwordHash: 'x', tier: 'free' })
      .returning();
    await env.db.insert(schema.userCredits).values({ userId: user?.id, balance: 5 });

    const [ct] = await env.db
      .insert(schema.catalogTypes)
      .values({ slug: `rec-${Date.now()}`, label: 'T' })
      .returning();
    const [cc] = await env.db
      .insert(schema.catalogCategories)
      .values({ typeId: ct?.id, slug: 'c', label: 'C' })
      .returning();
    const mkItem = (k: string) =>
      env.db
        .insert(schema.catalogItems)
        .values({ categoryId: cc?.id, label: 'I', r2Key: k, thumbnailKey: k })
        .returning();
    const [[m], [p], [b], [l]] = await Promise.all([
      mkItem('r/m.jpg'),
      mkItem('r/p.jpg'),
      mkItem('r/b.jpg'),
      mkItem('r/l.jpg'),
    ]);

    const [job] = await env.db
      .insert(schema.jobs)
      .values({ userId: user?.id, status: 'QUEUED', priority: false, creditsCharged: 1 })
      .returning();
    await env.db.insert(schema.jobInputs).values({
      jobId: job?.id,
      upperGarmentKey: `inputs/${job?.id}/garment.jpg`,
      modelCatalogId: m?.id,
      poseCatalogId: p?.id,
      backgroundCatalogId: b?.id,
      lowerCatalogId: l?.id,
    });
    for (const key of [
      `inputs/${job?.id}/garment.jpg`,
      'r/m.jpg',
      'r/p.jpg',
      'r/b.jpg',
      'r/l.jpg',
    ]) {
      await env.s3.send(
        new PutObjectCommand({
          Bucket: env.r2Bucket,
          Key: key,
          Body: Buffer.from('s'),
          ContentType: 'image/jpeg',
        }),
      );
    }

    // Simulate a "ghost" consumer reading the message without ACKing it
    await redis.xadd(STREAM, '*', 'jobId', job?.id, 'userId', user?.id);
    await redis.xreadgroup(
      'GROUP',
      GROUP,
      'ghost-consumer',
      'COUNT',
      '1',
      'BLOCK',
      '0',
      'STREAMS',
      STREAM,
      '>',
    );

    // Verify message is pending
    const pending = await redis.xpending(STREAM, GROUP, '-', '+', 10);
    expect((pending as unknown[]).length).toBeGreaterThan(0);

    // Run recovery with threshold=0 (claim everything regardless of idle time)
    const log = createLogger('test');
    const cfg = {
      db: env.db,
      redis,
      pub,
      storage: env.storage,
      s3: env.s3,
      r2Bucket: env.r2Bucket,
      log,
    };

    await recoverPendingJobs(redis, cfg, 0, log, [STREAM]);

    const [completed] = await env.db.select().from(schema.jobs).where(eq(schema.jobs.id, job?.id));
    expect(completed?.status).toBe('COMPLETED');
  });
});
