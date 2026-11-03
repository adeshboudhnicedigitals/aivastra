import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { cleanupComparisonReplay, schema } from '@aivastra/db';
import { createLogger } from '@aivastra/logger';
import { keys } from '@aivastra/storage';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { processJob } from '../../src/job/processor.js';
import { deregisterWorker, registerWorkers } from '../../src/worker/registry.js';
import { finalizeComparisonOutput } from '../../src/workflow/comparison-finalize.js';
import { type ComfyMock, startComfyMock } from '../helpers/comfy-mock.js';
import { setupTestEnv, type TestEnv } from '../helpers/containers.js';
import { forceIdle } from '../helpers/workers.js';

const WORKER_ID = 'test-worker-comparison-finalize';
const PERSON_NODE_ID = '20';
const GARMENT_NODE_ID = '21';
// comfy-mock's /history handler hardcodes output images under node '10'.
const OUTPUT_NODE_ID = '10';

describe('comparison output finalization fence', () => {
  let env: TestEnv;
  let redis: Redis;
  let pub: Redis;
  let comfy: ComfyMock;
  let realOutputBytes: Uint8Array;

  beforeAll(async () => {
    env = await setupTestEnv();
    redis = new Redis('redis://127.0.0.1:6379', { keyPrefix: `comfy-stage1:${WORKER_ID}:` });
    pub = new Redis('redis://127.0.0.1:6379', { keyPrefix: `comfy-stage1:${WORKER_ID}:` });
    comfy = await startComfyMock();

    await registerWorkers(redis, [{ id: WORKER_ID, url: comfy.url, apiKey: 'test-key' }]);
    await redis.setex(`worker:health:${WORKER_ID}`, 30, '1');

    // A real decodable PNG — sharp's webp re-encode needs valid image bytes,
    // unlike the default 8-byte magic-number stub the mock returns.
    realOutputBytes = await sharp({
      create: { width: 640, height: 800, channels: 3, background: { r: 90, g: 140, b: 200 } },
    })
      .png()
      .toBuffer();
  }, 60_000);

  afterAll(async () => {
    await deregisterWorker(redis, WORKER_ID);
    await comfy.close();
    redis.disconnect();
    pub.disconnect();
    await env.cleanup();
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    comfy.resetPrompts();
    comfy.setOptions({ outputBytes: realOutputBytes });
    await forceIdle(redis, WORKER_ID);
  });

  async function seedTryonDirectJob() {
    const [user] = await env.db
      .insert(schema.users)
      .values({ email: `tryon-direct-${randomUUID()}@test.com`, passwordHash: 'x', tier: 'free' })
      .returning();
    if (!user) throw new Error('failed to seed user');
    await env.db.insert(schema.userCredits).values({ userId: user.id, balance: 10 });

    const [template] = await env.db
      .insert(schema.workflowTemplates)
      .values({
        slug: `tryon-direct-tpl-${randomUUID()}`,
        label: 'Tryon direct test template',
        jsonContent: {
          [PERSON_NODE_ID]: { inputs: { image: '' } },
          [GARMENT_NODE_ID]: { inputs: { image: '' } },
          [OUTPUT_NODE_ID]: { class_type: 'SaveImage', inputs: {} },
        },
        faceNodeId: 'x',
        poseNodeId: 'x',
        bgNodeId: 'x',
        upperNodeIds: ['x'],
        facePhasePromptNode: 'x',
        garmentPhasePromptNode: 'x',
        workflowType: 'tryon',
        tryonPersonNodeId: PERSON_NODE_ID,
        tryonGarmentNodeId: GARMENT_NODE_ID,
        tryonOutputNodeId: OUTPUT_NODE_ID,
      })
      .returning();
    if (!template) throw new Error('failed to seed workflow template');

    const [job] = await env.db
      .insert(schema.jobs)
      .values({
        userId: user.id,
        status: 'QUEUED',
        creditsCharged: 0,
        source: 'comparison',
      })
      .returning();
    if (!job) throw new Error('failed to seed job');

    const personKey = `dev/${user.id}/${randomUUID()}.jpg`;
    const garmentKey = `dev/${user.id}/${randomUUID()}.jpg`;

    // Tryon-direct jobs are identified by shape: no faceId/backgroundId/poseId,
    // and params.personKey set (see processor.ts's top-level routing).
    await env.db.insert(schema.jobInputs).values({
      jobId: job.id,
      upperGarmentKey: garmentKey,
      faceId: null,
      backgroundId: null,
      poseId: null,
      params: { personKey, workflowTemplateId: template.id },
    });

    for (const key of [personKey, garmentKey]) {
      await env.s3.send(
        new PutObjectCommand({
          Bucket: env.r2Bucket,
          Key: key,
          Body: Buffer.from('stub'),
          ContentType: 'image/jpeg',
        }),
      );
    }

    const [source] = await env.db
      .insert(schema.jobs)
      .values({ status: 'COMPLETED', source: 'tryon' })
      .returning();
    await env.db.insert(schema.jobInputs).values({ jobId: source.id, params: { personKey } });
    const [comparison] = await env.db
      .insert(schema.workflowComparisons)
      .values({
        sourceJobId: source.id,
        generalJobId: job.id,
        templateId: template.id,
        templateVersion: 1,
        status: 'RUNNING',
      })
      .returning();
    return {
      jobId: job.id as string,
      userId: user.id as string,
      sourceId: source.id,
      comparisonId: comparison.id,
    };
  }

  const log = createLogger('test');
  // The requeue hands the original off atomically, so the message must really be pending
  // under this host's consumer; a made-up id now correctly counts as already handed off.
  async function deliver(jobId: string, userId: string) {
    // ioredis does not prefix XGROUP's key, so spell the prefix out; BUSYGROUP means it exists.
    await redis
      .call(
        'XGROUP',
        'CREATE',
        `comfy-stage1:${WORKER_ID}:jobs:normal`,
        'dispatcher-cg',
        '$',
        'MKSTREAM',
      )
      .catch(() => undefined);
    const id = (await redis.xadd('jobs:normal', '*', 'jobId', jobId, 'userId', userId)) as string;
    await redis.xreadgroup(
      'GROUP',
      'dispatcher-cg',
      hostname(),
      'COUNT',
      1,
      'STREAMS',
      'jobs:normal',
      '>',
    );
    return id;
  }
  async function run(jobId: string, userId: string, messageId = `${Date.now()}-0`) {
    await processJob(
      {
        comfyRedis: redis,
        db: env.db,
        redis,
        pub,
        storage: env.storage,
        log,
        withAdvisoryLock: env.withAdvisoryLock,
      },
      jobId,
      userId,
      'jobs:normal',
      messageId,
    );
  }
  async function hasOutput(jobId: string) {
    for (const key of [
      `outputs/${jobId}/result.png`,
      `outputs/${jobId}/result.webp`,
      `outputs/${jobId}/result.thumb.jpg`,
    ]) {
      try {
        await env.storage.headObject(key);
        return true;
      } catch {
        /* absent */
      }
    }
    return false;
  }
  it.each([
    'expired',
    'missing link',
    'source erased',
  ])('does not upload when %s before finalization', async (reason) => {
    const s = await seedTryonDirectJob();
    if (reason === 'expired')
      await env.db
        .update(schema.workflowComparisons)
        .set({ status: 'EXPIRED' })
        .where(eq(schema.workflowComparisons.id, s.comparisonId));
    if (reason === 'missing link')
      await env.db
        .delete(schema.workflowComparisons)
        .where(eq(schema.workflowComparisons.id, s.comparisonId));
    if (reason === 'source erased')
      await env.db
        .update(schema.jobInputs)
        .set({ params: { comparisonErased: true } })
        .where(eq(schema.jobInputs.jobId, s.sourceId));
    await run(s.jobId, s.userId);
    expect(await hasOutput(s.jobId)).toBe(false);
  });
  it('completes a comparison replay without enqueuing a customer webhook', async () => {
    const s = await seedTryonDirectJob();
    const before = await redis.xlen('webhooks:outbound');

    await run(s.jobId, s.userId);

    const [job] = await env.db.select().from(schema.jobs).where(eq(schema.jobs.id, s.jobId));
    expect(job?.status).toBe('COMPLETED');
    expect(await redis.xlen('webhooks:outbound')).toBe(before);
  });
  it('does not recreate outputs while cleanup owns the session lock', async () => {
    const s = await seedTryonDirectJob();
    await env.withAdvisoryLock(`workflow-comparison:output:${s.jobId}`, async () => {
      await run(s.jobId, s.userId, await deliver(s.jobId, s.userId));
      expect(await hasOutput(s.jobId)).toBe(false);
      const [job] = await env.db.select().from(schema.jobs).where(eq(schema.jobs.id, s.jobId));
      expect(job?.status).toBe('QUEUED');
      const entries = await redis.xrange('jobs:normal', '-', '+');
      expect(entries.some(([, fields]) => fields.includes(s.jobId))).toBe(true);
    });
  });
  it('deletes uncommitted deterministic objects if cancellation wins after PUT', async () => {
    const s = await seedTryonDirectJob();
    const put = env.storage.putObject.bind(env.storage);
    vi.spyOn(env.storage, 'putObject').mockImplementationOnce(async (...args) => {
      await put(...args);
      await env.db
        .update(schema.jobs)
        .set({ status: 'CANCELLED' })
        .where(eq(schema.jobs.id, s.jobId));
    });
    await run(s.jobId, s.userId);
    expect(await hasOutput(s.jobId)).toBe(false);
    const [root] = await env.db
      .select()
      .from(schema.workflowComparisons)
      .where(eq(schema.workflowComparisons.id, s.comparisonId));
    expect(root?.status).toBe('EXPIRED');
  });

  it('retains roots when erasure races a finalizer already holding the output lock', async () => {
    const s = await seedTryonDirectJob();
    const put = env.storage.putObject.bind(env.storage);
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const resumed = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(env.storage, 'putObject').mockImplementationOnce(async (...args) => {
      await put(...args);
      entered();
      await resumed;
    });
    const cleanup = () =>
      cleanupComparisonReplay({
        db: env.db,
        withAdvisoryLock: env.withAdvisoryLock,
        comparisonId: s.comparisonId,
        io: {
          deleteObject: (key) => env.storage.deleteObject(key),
          replayOutputKeys: (id) => [
            keys.output(id, 'png'),
            keys.output(id, 'webp'),
            keys.outputThumb(id),
          ],
        },
      });
    const processing = run(s.jobId, s.userId);
    await started;
    try {
      await env.db
        .update(schema.workflowComparisons)
        .set({ status: 'EXPIRED' })
        .where(eq(schema.workflowComparisons.id, s.comparisonId));
      expect(await cleanup()).toMatchObject({ complete: false, busy: true });
      expect(await hasOutput(s.jobId)).toBe(true);
    } finally {
      release();
      await processing;
    }
    expect(await cleanup()).toMatchObject({ complete: true, deleted: true });
    expect(await hasOutput(s.jobId)).toBe(false);
    expect(
      await env.db
        .select()
        .from(schema.workflowComparisons)
        .where(eq(schema.workflowComparisons.id, s.comparisonId)),
    ).toHaveLength(0);
  });

  it('keeps an immediate cleanup obligation if a PUT response and subsequent deletion fail', async () => {
    const s = await seedTryonDirectJob();
    const put = env.storage.putObject.bind(env.storage);
    vi.spyOn(env.storage, 'putObject').mockImplementationOnce(async (...args) => {
      await put(...args);
      throw new Error('PUT response lost');
    });
    vi.spyOn(env.storage, 'deleteObject').mockRejectedValue(new Error('storage down'));
    await run(s.jobId, s.userId);
    expect(await hasOutput(s.jobId)).toBe(true);
    const [root] = await env.db
      .select()
      .from(schema.workflowComparisons)
      .where(eq(schema.workflowComparisons.id, s.comparisonId));
    expect(root?.status).toBe('EXPIRED');
    expect(root?.generalJobId).toBe(s.jobId);
    vi.restoreAllMocks();
    const cleaned = await cleanupComparisonReplay({
      db: env.db,
      withAdvisoryLock: env.withAdvisoryLock,
      comparisonId: s.comparisonId,
      io: {
        deleteObject: (key) => env.storage.deleteObject(key),
        replayOutputKeys: (id) => [
          keys.output(id, 'png'),
          keys.output(id, 'webp'),
          keys.outputThumb(id),
        ],
      },
    });
    expect(cleaned.complete).toBe(true);
    expect(await hasOutput(s.jobId)).toBe(false);
  });

  it('preserves a committed result when a second finalizer arrives late', async () => {
    const s = await seedTryonDirectJob();
    await env.db
      .update(schema.jobs)
      .set({ status: 'COMPLETED' })
      .where(eq(schema.jobs.id, s.jobId));
    const resultKey = keys.output(s.jobId, 'webp');
    await env.storage.putObject(resultKey, realOutputBytes, 'image/webp');
    await env.db.insert(schema.jobOutputs).values({ jobId: s.jobId, resultKey });
    const result = await finalizeComparisonOutput(
      {
        imageBytes: realOutputBytes,
        jobId: s.jobId,
        userId: s.userId,
        jobWatermark: false,
        db: env.db,
        pub,
        storage: env.storage,
        jobLog: log,
      },
      env.withAdvisoryLock,
    );
    expect(result.completed).toBe(false);
    expect(await hasOutput(s.jobId)).toBe(true);
    const [job] = await env.db.select().from(schema.jobs).where(eq(schema.jobs.id, s.jobId));
    expect(job?.status).toBe('COMPLETED');
  });
});
