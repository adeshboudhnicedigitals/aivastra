import { schema } from '@aivastra/db';
import { createLogger } from '@aivastra/logger';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as progress from '../../src/comfyui/progress.js';
import { processJob } from '../../src/job/processor.js';
import * as registry from '../../src/worker/registry.js';
import { deregisterWorker, registerWorkers, setWorkerStatus } from '../../src/worker/registry.js';
import { type ComfyMock, startComfyMock } from '../helpers/comfy-mock.js';
import { setupTestEnv, type TestEnv } from '../helpers/containers.js';
import { assertQueueExhaustion } from '../helpers/queue-exhaustion.js';

const WORKER_ID = 'test-worker-happy';

describe('dispatcher happy path', () => {
  let env: TestEnv;
  let redis: Redis;
  let pub: Redis;
  let comfy: ComfyMock;

  beforeAll(async () => {
    env = await setupTestEnv();
    redis = new Redis('redis://127.0.0.1:6379', { keyPrefix: `comfy-stage1:${WORKER_ID}:` });
    pub = new Redis('redis://127.0.0.1:6379', { keyPrefix: `comfy-stage1:${WORKER_ID}:` });
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
    comfy.resetPrompts();
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

    const [workflow] = await env.db
      .insert(schema.workflowTemplates)
      .values({
        slug: `hp-wf-${Date.now()}`,
        label: 'Happy path test workflow',
        jsonContent: {
          f: { class_type: 'LoadImage', inputs: { image: 'x.jpg' } },
          p: { class_type: 'LoadImage', inputs: { image: 'x.jpg' } },
          b: { class_type: 'LoadImage', inputs: { image: 'x.jpg' } },
          g: { class_type: 'LoadImage', inputs: { image: 'x.jpg' } },
          out: { class_type: 'SaveImage', inputs: { images: ['f', 0] } },
        },
        workflowType: 'regular',
        faceNodeId: 'f',
        poseNodeId: 'p',
        bgNodeId: 'b',
        upperNodeIds: ['g'],
        facePhasePromptNode: 'f',
        garmentPhasePromptNode: 'f',
      })
      .returning();

    const [[face], [background], [pose], [l]] = await Promise.all([
      env.db
        .insert(schema.modelFaces)
        .values({
          gender: 'women',
          label: 'Model',
          r2Key: 'catalog/m/m.jpg',
          thumbnailKey: 'catalog/m/m.jpg',
          faceSideR2Key: 'catalog/m/m.jpg',
        })
        .returning(),
      env.db
        .insert(schema.modelBackgrounds)
        .values({ label: 'Bg', r2Key: 'catalog/b/b.jpg', thumbnailKey: 'catalog/b/b.jpg' })
        .returning(),
      env.db
        .insert(schema.modelPoseAssets)
        .values({
          label: 'Pose',
          r2Key: 'catalog/p/p.jpg',
          thumbnailKey: 'catalog/p/p.jpg',
          workflowTemplateId: workflow?.id,
        })
        .returning(),
      env.db
        .insert(schema.catalogItems)
        .values({
          categoryId: cc?.id,
          type: 'lower',
          label: 'Lower',
          r2Key: 'catalog/l/l.jpg',
          thumbnailKey: 'catalog/l/l.jpg',
        })
        .returning(),
    ]);

    const [job] = await env.db
      .insert(schema.jobs)
      .values({ userId: user?.id, status: 'QUEUED', priority: false, creditsCharged: 1 })
      .returning();

    await env.db.insert(schema.jobInputs).values({
      jobId: job?.id,
      upperGarmentKey: `inputs/${job?.id}/garment.jpg`,
      faceId: face?.id,
      poseId: pose?.id,
      backgroundId: background?.id,
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
        comfyRedis: redis,
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
      '1-1',
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
  it('execution timeout remains an ordinary failure: consumes an attempt and requeues without refund', async () => {
    const { jobId, userId } = await seedJob();
    if (!jobId || !userId) throw new Error('missing fixture IDs');
    const completion = vi
      .spyOn(progress, 'waitForCompletion')
      .mockRejectedValue(
        new Error(`ComfyUI history polling timeout after 300000ms for prompt mock`),
      );
    try {
      await processJob(
        {
          comfyRedis: redis,
          db: env.db,
          redis,
          pub,
          storage: env.storage,
          s3: env.s3,
          r2Bucket: env.r2Bucket,
          log: createLogger('test'),
        },
        jobId,
        userId,
        'jobs:normal',
        '2-1',
      );
      const [job] = await env.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
      expect(job?.status).toBe('QUEUED');
      expect(job?.attempts).toBe(1);
      const [credits] = await env.db
        .select()
        .from(schema.userCredits)
        .where(eq(schema.userCredits.userId, userId));
      expect(credits?.balance).toBe(5);
      expect(
        await env.db.select().from(schema.jobOutputs).where(eq(schema.jobOutputs.jobId, jobId)),
      ).toEqual([]);
    } finally {
      completion.mockRestore();
    }
  });

  it('holds the worker through terminal publication failure and releases it once', async () => {
    const { jobId, userId } = await seedJob();
    const completion = vi
      .spyOn(progress, 'waitForCompletion')
      .mockResolvedValue({ status: 'queue_cleanup_failed' });
    const release = vi.spyOn(registry, 'releaseWorker');
    const originalPublish = pub.publish.bind(pub);
    const publication = vi.spyOn(pub, 'publish');
    let failed = false;
    publication.mockImplementation(async (...args) => {
      if (!failed && String(args[1]).includes('FAILED')) {
        failed = true;
        expect((await registry.getWorkers(redis)).get(WORKER_ID)?.status).toBe('BUSY');
        expect(release).not.toHaveBeenCalled();
        throw new Error('injected terminal publication failure');
      }
      return originalPublish(...args);
    });
    try {
      await processJob(
        {
          comfyRedis: redis,
          db: env.db,
          redis,
          pub,
          storage: env.storage,
          s3: env.s3,
          r2Bucket: env.r2Bucket,
          log: createLogger('test'),
        },
        jobId,
        userId,
        'jobs:normal',
        '4-1',
      );
      expect(failed).toBe(true);
      expect(release).toHaveBeenCalledTimes(1);
      expect((await registry.getWorkers(redis)).get(WORKER_ID)?.status).toBe('IDLE');
    } finally {
      completion.mockRestore();
      release.mockRestore();
      publication.mockRestore();
    }
  });

  it('queue_cleanup_failed terminates and refunds without attempts, output handling or requeue', async () => {
    const { jobId, userId } = await seedJob();
    if (!jobId || !userId) throw new Error('missing fixture IDs');
    await assertQueueExhaustion(
      {
        comfyRedis: redis,
        db: env.db,
        redis,
        pub,
        storage: env.storage,
        s3: env.s3,
        r2Bucket: env.r2Bucket,
        log: createLogger('test'),
      },
      comfy,
      WORKER_ID,
      jobId,
      userId,
    );
  });
  it.each([
    false,
    true,
  ])('admin signal cancels a running catalogue prompt with one refund (prior admin refund=%s)', async (priorRefund) => {
    const { jobId, userId } = await seedJob();
    if (!jobId || !userId) throw new Error('missing fixture IDs');
    await env.db.update(schema.jobs).set({ source: 'catalog' }).where(eq(schema.jobs.id, jobId));
    const { capabilitiesKey, comfyVersionKey } = await import('@aivastra/types');
    const capKey = capabilitiesKey(WORKER_ID);
    await redis.set(
      capKey,
      JSON.stringify({
        queuePromptIdentityValidated: true,
        queueDeleteValidated: true,
        promptScopedInterruptValidated: true,
        validatedComfyVersion: '0.37.0',
        validatedAt: '2026-10-02',
        validationReference: 'local-test',
      }),
    );
    await redis.setex(comfyVersionKey(WORKER_ID), 60, '0.37.0');
    const deletesBefore = comfy.deleteCalls().length;
    const interruptsBefore = comfy.interruptCalls().length;
    let signalled = false;
    comfy.setOptions({
      completionDelayMs: 100_000,
      onRequest: async (method, path) => {
        if (!signalled && method === 'POST' && path === '/prompt') {
          signalled = true;
          const [job] = await env.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
          expect(job.status).toBe('GENERATING');
          if (priorRefund) {
            await env.db
              .insert(schema.creditLedger)
              .values({ userId, jobId, delta: 1, reason: 'REFUND_ADMIN_CANCEL' });
            await env.db
              .update(schema.userCredits)
              .set({ balance: 6 })
              .where(eq(schema.userCredits.userId, userId));
          }
          await redis.set(`job:cancel:${jobId}`, '1', 'EX', 600);
        }
      },
    });
    const publication = vi.spyOn(pub, 'publish');
    try {
      await processJob(
        {
          db: env.db,
          redis,
          comfyRedis: redis,
          pub,
          storage: env.storage,
          s3: env.s3,
          r2Bucket: env.r2Bucket,
          log: createLogger('test'),
        },
        jobId,
        userId,
        'jobs:normal',
        '5-1',
      );
      const [job] = await env.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
      expect(job.status).toBe('CANCELLED');
      expect(
        await env.db.select().from(schema.jobOutputs).where(eq(schema.jobOutputs.jobId, jobId)),
      ).toEqual([]);
      const refunds = await env.db
        .select()
        .from(schema.creditLedger)
        .where(eq(schema.creditLedger.jobId, jobId));
      expect(refunds).toHaveLength(1);
      expect(refunds[0].reason).toBe(priorRefund ? 'REFUND_ADMIN_CANCEL' : 'JOB_CANCEL_REFUND');
      const [credits] = await env.db
        .select()
        .from(schema.userCredits)
        .where(eq(schema.userCredits.userId, userId));
      expect(credits.balance).toBe(6);
      expect(comfy.deleteCalls().slice(deletesBefore)).toEqual([[comfy.lastPromptId()]]);
      expect(comfy.interruptCalls().slice(interruptsBefore)).toEqual([comfy.lastPromptId()]);
      expect(publication.mock.calls.some((call) => String(call[1]).includes('COMPLETED'))).toBe(
        false,
      );
    } finally {
      publication.mockRestore();
      await redis.del(capKey, comfyVersionKey(WORKER_ID), `job:cancel:${jobId}`);
    }
  });

  it('completion after a DB cancel stays cancelled, writes no outputs and still ACKs', async () => {
    const { jobId, userId } = await seedJob();
    let cancelled = false;
    comfy.setOptions({
      onRequest: async (_method, path) => {
        if (path === '/view' && !cancelled) {
          cancelled = true;
          await env.db
            .update(schema.jobs)
            .set({ status: 'CANCELLED', errorCode: 'ADMIN_CANCEL' })
            .where(eq(schema.jobs.id, jobId));
        }
      },
    });
    const publication = vi.spyOn(pub, 'publish');
    const ack = vi.spyOn(redis, 'xack');
    try {
      await processJob(
        {
          db: env.db,
          redis,
          comfyRedis: redis,
          pub,
          storage: env.storage,
          s3: env.s3,
          r2Bucket: env.r2Bucket,
          log: createLogger('test'),
        },
        jobId,
        userId,
        'jobs:normal',
        '6-1',
      );
      expect(cancelled).toBe(true);
      const [job] = await env.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
      expect(job.status).toBe('CANCELLED');
      expect(job.errorCode).toBe('ADMIN_CANCEL');
      expect(
        await env.db.select().from(schema.jobOutputs).where(eq(schema.jobOutputs.jobId, jobId)),
      ).toEqual([]);
      expect(publication.mock.calls.some((call) => String(call[1]).includes('COMPLETED'))).toBe(
        false,
      );
      expect(ack).toHaveBeenCalledWith('jobs:normal', 'dispatcher-cg', '6-1');
    } finally {
      publication.mockRestore();
      ack.mockRestore();
    }
  });

  it('a cancel flag arriving after completion cannot refund or change the completed job', async () => {
    const { jobId, userId } = await seedJob();
    const cfg = {
      db: env.db,
      redis,
      comfyRedis: redis,
      pub,
      storage: env.storage,
      s3: env.s3,
      r2Bucket: env.r2Bucket,
      log: createLogger('test'),
    };
    await processJob(cfg, jobId, userId, 'jobs:normal', '7-1');
    await redis.set(`job:cancel:${jobId}`, '1', 'EX', 600);
    try {
      await processJob(cfg, jobId, userId, 'jobs:normal', '7-2');
      const [job] = await env.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
      expect(job.status).toBe('COMPLETED');
      expect(
        await env.db.select().from(schema.creditLedger).where(eq(schema.creditLedger.jobId, jobId)),
      ).toEqual([]);
    } finally {
      await redis.del(`job:cancel:${jobId}`);
    }
  });
});
