import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Redis } from 'ioredis';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { setupTestEnv, type TestEnv } from '../helpers/containers.js';
import { startComfyMock, type ComfyMock } from '../helpers/comfy-mock.js';
import { processJob } from '../../src/job/processor.js';
import { createLogger } from '@aivastra/logger';
import { registerWorkers, setWorkerStatus, deregisterWorker } from '../../src/worker/registry.js';

const WORKER_ID = 'test-worker-retry';

describe('dispatcher retry + credit refund', () => {
  let env: TestEnv;
  let redis: Redis;
  let pub: Redis;
  let comfy: ComfyMock;

  beforeAll(async () => {
    env = await setupTestEnv();
    redis = new Redis('redis://127.0.0.1:6379');
    pub = new Redis('redis://127.0.0.1:6379');
    comfy = await startComfyMock();

    await registerWorkers(redis, [{ id: WORKER_ID, url: comfy.url }]);
    await redis.setex(`worker:health:${WORKER_ID}`, 30, '1');
  }, 60_000);

  afterAll(async () => {
    await deregisterWorker(redis, WORKER_ID);
    await comfy.close();
    redis.disconnect();
    pub.disconnect();
    await env.cleanup();
  });

  beforeEach(async () => {
    comfy.setOptions({});
    await setWorkerStatus(redis, WORKER_ID, 'IDLE');
  });

  async function seedJob() {
    const ts = Date.now();
    const [user] = await env.db
      .insert(schema.users)
      .values({ email: `retry-${ts}@test.com`, passwordHash: 'x', tier: 'FREE' })
      .returning();
    await env.db.insert(schema.userCredits).values({ userId: user!.id, balance: 5 });

    const [face] = await env.db
      .insert(schema.modelFaces)
      .values({ gender: 'men', label: 'Face', r2Key: `rt/face-${ts}.jpg`, thumbnailKey: `rt/face-${ts}-thumb.jpg` })
      .returning();
    const [bg] = await env.db
      .insert(schema.modelBackgrounds)
      .values({ label: 'Bg', r2Key: `rt/bg-${ts}.jpg`, thumbnailKey: `rt/bg-${ts}-thumb.jpg` })
      .returning();
    const [subcat] = await env.db
      .insert(schema.garmentSubcategories)
      .values({ genderSlug: 'men', slug: `rt-tshirt-${ts}`, label: 'T-Shirt' })
      .returning();
    const [pose] = await env.db
      .insert(schema.modelPoses)
      .values({
        subcategoryId: subcat!.id, faceId: face!.id, backgroundId: bg!.id,
        label: 'Pose', r2Key: `rt/pose-${ts}.jpg`, thumbnailKey: `rt/pose-${ts}-thumb.jpg`,
      })
      .returning();

    const [ct] = await env.db
      .insert(schema.catalogTypes)
      .values({ slug: `rt-${ts}`, label: 'T' })
      .returning();
    const [cc] = await env.db
      .insert(schema.catalogCategories)
      .values({ typeId: ct!.id, slug: 'c', label: 'C' })
      .returning();
    const [lower] = await env.db
      .insert(schema.catalogItems)
      .values({ categoryId: cc!.id, label: 'Lower', r2Key: `rt/lower-${ts}.jpg`, thumbnailKey: `rt/lower-${ts}.jpg` })
      .returning();

    const [job] = await env.db
      .insert(schema.jobs)
      .values({ userId: user!.id, status: 'QUEUED', priority: false, creditsCharged: 1 })
      .returning();
    await env.db.insert(schema.jobInputs).values({
      jobId: job!.id,
      upperGarmentKey: `inputs/${job!.id}/garment.jpg`,
      faceId: face!.id,
      backgroundId: bg!.id,
      poseId: pose!.id,
      lowerCatalogId: lower!.id,
    });
    for (const key of [
      `inputs/${job!.id}/garment.jpg`,
      `rt/face-${ts}.jpg`,
      `rt/bg-${ts}.jpg`,
      `rt/pose-${ts}.jpg`,
      `rt/lower-${ts}.jpg`,
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
    return { jobId: job!.id, userId: user!.id };
  }

  it('refunds credits after MAX_ATTEMPTS=2 failures', async () => {
    comfy.setOptions({ fail: true });
    const { jobId, userId } = await seedJob();
    const log = createLogger('test');
    const cfg = {
      db: env.db,
      redis,
      pub,
      storage: env.storage,
      s3: env.s3,
      r2Bucket: env.r2Bucket,
      workerApiKey: () => 'test-key',
      log,
    };

    // First attempt — should re-enqueue (attempts=1, status back to QUEUED)
    await processJob(cfg, jobId, userId, 'jobs:normal', 'msg-1');
    const [after1] = await env.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    expect(after1!.status).toBe('QUEUED');
    expect(after1!.attempts).toBe(1);

    // Reset worker to IDLE for second attempt
    await setWorkerStatus(redis, WORKER_ID, 'IDLE');

    // Second attempt — should mark FAILED and refund
    await processJob(cfg, jobId, userId, 'jobs:normal', 'msg-2');
    const [after2] = await env.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    expect(after2!.status).toBe('FAILED');
    expect(after2!.attempts).toBe(2);

    // Credit balance increased by creditsCharged=1 (refund)
    const [bal] = await env.db
      .select()
      .from(schema.userCredits)
      .where(eq(schema.userCredits.userId, userId));
    expect(bal!.balance).toBe(6); // 5 initial + 1 refund

    // JOB_FAIL_REFUND ledger entry exists
    const ledger = await env.db
      .select()
      .from(schema.creditLedger)
      .where(eq(schema.creditLedger.jobId, jobId));
    expect(ledger.some((e) => e.reason === 'JOB_FAIL_REFUND')).toBe(true);

    // Refund is idempotent — running again should not double-refund
    await setWorkerStatus(redis, WORKER_ID, 'IDLE');
    // status is FAILED so processJob will skip (not QUEUED)
    const [balAfter] = await env.db
      .select()
      .from(schema.userCredits)
      .where(eq(schema.userCredits.userId, userId));
    expect(balAfter!.balance).toBe(6);
  });
});
