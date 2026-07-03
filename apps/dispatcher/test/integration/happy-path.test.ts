import { schema } from '@aivastra/db';
import { createLogger } from '@aivastra/logger';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { processJob } from '../../src/job/processor.js';
import { deregisterWorker, registerWorkers, setWorkerStatus } from '../../src/worker/registry.js';
import { type ComfyMock, startComfyMock } from '../helpers/comfy-mock.js';
import { setupTestEnv, type TestEnv } from '../helpers/containers.js';

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

    await registerWorkers(redis, [{ id: WORKER_ID, url: comfy.url, apiKey: 'test-key' }]);
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
    const [user] = await env.db
      .insert(schema.users)
      .values({ email: `happy-${Date.now()}@test.com`, passwordHash: 'x', tier: 'free' })
      .returning();
    await env.db.insert(schema.userCredits).values({ userId: user?.id, balance: 5 });

    const [ct] = await env.db
      .insert(schema.catalogTypes)
      .values({ slug: `hp-${Date.now()}`, label: 'T' })
      .returning();
    const [cc] = await env.db
      .insert(schema.catalogCategories)
      .values({ typeId: ct?.id, slug: 'c', label: 'C' })
      .returning();

    const mkItem = (label: string, r2Key: string) =>
      env.db
        .insert(schema.catalogItems)
        .values({ categoryId: cc?.id, label, r2Key, thumbnailKey: r2Key })
        .returning();

    const [[m], [p], [b], [l]] = await Promise.all([
      mkItem('Model', 'catalog/m/m.jpg'),
      mkItem('Pose', 'catalog/p/p.jpg'),
      mkItem('Bg', 'catalog/b/b.jpg'),
      mkItem('Lower', 'catalog/l/l.jpg'),
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

    // Upload stub objects to MinIO so presignGet works
    for (const key of [
      `inputs/${job?.id}/garment.jpg`,
      'catalog/m/m.jpg',
      'catalog/p/p.jpg',
      'catalog/b/b.jpg',
      'catalog/l/l.jpg',
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

    return { jobId: job?.id, userId: user?.id };
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
        log,
      },
      jobId,
      userId,
      'jobs:normal',
      'mock-msg-id',
    );

    const [job] = await env.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    expect(job?.status).toBe('COMPLETED');
    expect(job?.workerId).toBe(WORKER_ID);

    const [output] = await env.db
      .select()
      .from(schema.jobOutputs)
      .where(eq(schema.jobOutputs.jobId, jobId));
    expect(output?.resultKey).toBe(`outputs/${jobId}/result.png`);

    // Verify result file exists in MinIO
    const obj = await env.s3.send(
      new GetObjectCommand({ Bucket: env.r2Bucket, Key: `outputs/${jobId}/result.png` }),
    );
    expect(obj.$metadata.httpStatusCode).toBe(200);

    // Worker should be back to IDLE
    const { getWorkers } = await import('../../src/worker/registry.js');
    const workers = await getWorkers(redis);
    expect(workers.get(WORKER_ID)?.status).toBe('IDLE');
  });
});
