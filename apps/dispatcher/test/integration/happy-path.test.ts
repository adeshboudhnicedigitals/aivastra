import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Redis } from 'ioredis';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { setupTestEnv, type TestEnv } from '../helpers/containers.js';
import { startComfyMock, type ComfyMock } from '../helpers/comfy-mock.js';
import { processJob } from '../../src/job/processor.js';
import { createLogger } from '@aivastra/logger';
import { registerWorkers, setWorkerStatus, deregisterWorker } from '../../src/worker/registry.js';

const WORKER_ID = 'test-worker-happy';

describe('dispatcher happy path', () => {
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
      .values({ email: `happy-${ts}@test.com`, passwordHash: 'x', tier: 'FREE' })
      .returning();
    await env.db.insert(schema.userCredits).values({ userId: user!.id, balance: 5 });

    // Model assets (new schema)
    const [face] = await env.db
      .insert(schema.modelFaces)
      .values({ gender: 'men', label: 'Face', r2Key: `hp/face-${ts}.jpg`, thumbnailKey: `hp/face-${ts}-thumb.jpg` })
      .returning();
    const [bg] = await env.db
      .insert(schema.modelBackgrounds)
      .values({ label: 'Bg', r2Key: `hp/bg-${ts}.jpg`, thumbnailKey: `hp/bg-${ts}-thumb.jpg` })
      .returning();
    const [subcat] = await env.db
      .insert(schema.garmentSubcategories)
      .values({ genderSlug: 'men', slug: `hp-tshirt-${ts}`, label: 'T-Shirt' })
      .returning();
    const [pose] = await env.db
      .insert(schema.modelPoses)
      .values({
        subcategoryId: subcat!.id, faceId: face!.id, backgroundId: bg!.id,
        label: 'Pose', r2Key: `hp/pose-${ts}.jpg`, thumbnailKey: `hp/pose-${ts}-thumb.jpg`,
      })
      .returning();

    // Optional lower garment (catalog item)
    const [ct] = await env.db
      .insert(schema.catalogTypes)
      .values({ slug: `hp-${ts}`, label: 'T' })
      .returning();
    const [cc] = await env.db
      .insert(schema.catalogCategories)
      .values({ typeId: ct!.id, slug: 'c', label: 'C' })
      .returning();
    const [lower] = await env.db
      .insert(schema.catalogItems)
      .values({ categoryId: cc!.id, label: 'Lower', r2Key: `hp/lower-${ts}.jpg`, thumbnailKey: `hp/lower-${ts}.jpg` })
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

    // Upload stub objects to MinIO so presignGet works
    for (const key of [
      `inputs/${job!.id}/garment.jpg`,
      `hp/face-${ts}.jpg`,
      `hp/bg-${ts}.jpg`,
      `hp/pose-${ts}.jpg`,
      `hp/lower-${ts}.jpg`,
    ]) {
      await env.s3.send(
        new PutObjectCommand({
          Bucket: env.r2Bucket,
          Key: key,
          Body: Buffer.from('stub'),
          ContentType: 'image/jpeg',
        }),
      );
    }

    return { jobId: job!.id, userId: user!.id };
  }

  it('processes job to COMPLETED — result uploaded to R2, workerId set', async () => {
    const { jobId, userId } = await seedJob();
    const log = createLogger('test');

    await processJob(
      {
        db: env.db,
        redis,
        pub,
        storage: env.storage,
        s3: env.s3,
        r2Bucket: env.r2Bucket,
        workerApiKey: () => 'test-key',
        log,
      },
      jobId,
      userId,
      'jobs:normal',
      'mock-msg-id',
    );

    const [job] = await env.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    expect(job!.status).toBe('COMPLETED');
    expect(job!.workerId).toBe(WORKER_ID);

    const [output] = await env.db
      .select()
      .from(schema.jobOutputs)
      .where(eq(schema.jobOutputs.jobId, jobId));
    expect(output!.resultKey).toBe(`outputs/${jobId}/result.png`);

    // Verify result file exists in MinIO
    const obj = await env.s3.send(
      new GetObjectCommand({ Bucket: env.r2Bucket, Key: `outputs/${jobId}/result.png` }),
    );
    expect(obj.$metadata.httpStatusCode).toBe(200);

    // Worker should be back to IDLE
    const { getWorkers } = await import('../../src/worker/registry.js');
    const workers = await getWorkers(redis);
    expect(workers.get(WORKER_ID)!.status).toBe('IDLE');
  });
});
