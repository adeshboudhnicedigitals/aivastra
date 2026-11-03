import { schema } from '@aivastra/db';
import { createLogger } from '@aivastra/logger';
import { HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { and, eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  garmentExtractCacheId,
  garmentExtractCacheKey,
  garmentExtractLockKey,
} from '../../src/job/garment-extract-phase.js';
import { processJob } from '../../src/job/processor.js';
import { deregisterWorker, registerWorkers, setWorkerStatus } from '../../src/worker/registry.js';
import { type ComfyMock, startComfyMock } from '../helpers/comfy-mock.js';
import { setupTestEnv, type TestEnv } from '../helpers/containers.js';

const WORKER_ID = 'test-worker-garment-extract';

/**
 * Garment-extract is an in-job pre-step: the extract workflow's output replaces the upper
 * garment the main workflow uploads. Same job, same charge. Like the mannequin phase,
 * "no worker" is capacity (requeue, no attempt consumed) and a finished intermediate in
 * storage is reused instead of re-running the GPU.
 */
describe('dispatcher — garment extract phase', () => {
  let env: TestEnv;
  let redis: Redis;
  let pub: Redis;
  let comfy: ComfyMock;

  beforeAll(async () => {
    env = await setupTestEnv();
    redis = new Redis('redis://127.0.0.1:6379', { keyPrefix: `comfy-stage1:${WORKER_ID}:` });
    pub = new Redis('redis://127.0.0.1:6379', { keyPrefix: `comfy-stage1:${WORKER_ID}:` });
    comfy = await startComfyMock();
    await registerWorkers(redis, [
      {
        id: WORKER_ID,
        url: comfy.url,
        apiKey: 'test-key',
        allowedJobTypes: ['saree', 'catalogue'],
      },
    ]);
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
    // The health key has a 30s TTL and this file now runs longer than that.
    await redis.setex(`worker:health:${WORKER_ID}`, 30, '1');
  });

  // `extract` is what the API snapshotted into the job's params at creation; `typeEnabled` is
  // the garment type's live toggle, which defaults to the same value but can be flipped off
  // afterwards by an admin.
  async function seedJob(opts: { extract: boolean; typeEnabled?: boolean }) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const [user] = await env.db
      .insert(schema.users)
      .values({ email: `gx-${suffix}@test.com`, passwordHash: 'x', tier: 'free' })
      .returning();
    // biome-ignore lint/style/noNonNullAssertion: insert always returns the row
    const userId = user!.id;
    await env.db.insert(schema.userCredits).values({ userId, balance: 5 });

    const [extractTemplate] = await env.db
      .insert(schema.workflowTemplates)
      .values({
        slug: `gx-extract-${suffix}`,
        label: 'Extract',
        jsonContent: {
          '1': { class_type: 'LoadImage', inputs: { image: 'placeholder.jpg' } },
          '10': { class_type: 'SaveImage', inputs: { images: ['1', 0] } },
        },
        workflowType: 'garment_extract',
        faceNodeId: '',
        poseNodeId: '',
        bgNodeId: '',
        upperNodeIds: [],
        facePhasePromptNode: '',
        garmentPhasePromptNode: '',
        tryonGarmentNodeId: '1',
        tryonOutputNodeId: '10',
      })
      .returning();
    const [mainTemplate] = await env.db
      .insert(schema.workflowTemplates)
      .values({
        slug: `gx-main-${suffix}`,
        label: 'Main',
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
        resultNodeId: '10',
      })
      .returning();
    const [garmentType] = await env.db
      .insert(schema.garmentSubcategories)
      .values({
        genderSlug: 'women',
        slug: `gx-lehenga-${suffix}`,
        label: 'Lehenga',
        requiresGarmentExtractStep: opts.typeEnabled ?? opts.extract,
        garmentExtractWorkflowTemplateId: extractTemplate?.id,
      })
      .returning();
    const [face] = await env.db
      .insert(schema.modelFaces)
      .values({
        gender: 'women',
        label: 'F',
        r2Key: 'f.jpg',
        thumbnailKey: 'f.jpg',
        faceSideR2Key: 'f.jpg',
      })
      .returning();
    const [bg] = await env.db
      .insert(schema.modelBackgrounds)
      .values({ label: `Bg-${suffix}`, r2Key: 'b.jpg', thumbnailKey: 'b.jpg' })
      .returning();
    const [pose] = await env.db
      .insert(schema.modelPoseAssets)
      .values({ label: `Pose-${suffix}`, r2Key: 'p.jpg', thumbnailKey: 'p.jpg' })
      .returning();
    const [job] = await env.db
      .insert(schema.jobs)
      .values({ userId, status: 'QUEUED', priority: false, creditsCharged: 1 })
      .returning();
    // biome-ignore lint/style/noNonNullAssertion: insert always returns the row
    const jobId = job!.id;
    const rawGarmentKey = `inputs/${jobId}/garment.jpg`;
    await env.db.insert(schema.jobInputs).values({
      jobId,
      upperGarmentKey: rawGarmentKey,
      faceId: face?.id,
      backgroundId: bg?.id,
      poseId: pose?.id,
      garmentTypeId: garmentType?.id,
      // workflowTemplateId is snapshotted exactly as resolveTryonPlan does, which is what
      // makes the dispatcher skip its garmentTypeId branch — the extract hook must not live there.
      params: {
        workflowTemplateId: mainTemplate?.id,
        ...(opts.extract
          ? {
              needsGarmentExtract: true,
              garmentExtractWorkflowTemplateId: extractTemplate?.id,
              garmentExtractTemplateVersion: extractTemplate?.version,
            }
          : {}),
      },
    });
    for (const key of [rawGarmentKey, 'f.jpg', 'b.jpg', 'p.jpg']) {
      await env.s3.send(
        new PutObjectCommand({
          Bucket: env.r2Bucket,
          Key: key,
          Body: Buffer.from('stub'),
          ContentType: 'image/jpeg',
        }),
      );
    }
    return {
      jobId,
      userId,
      rawGarmentKey,
      shared: {
        extractTemplateId: extractTemplate?.id,
        extractTemplateVersion: extractTemplate?.version,
        mainTemplateId: mainTemplate?.id,
        garmentTypeId: garmentType?.id,
        faceId: face?.id,
        bgId: bg?.id,
      },
    };
  }

  // Another pose of the SAME request: same user, garment upload, garment type and workflow
  // snapshot, different pose — which is how a multi-pose submission looks to the dispatcher.
  async function seedSibling(base: Awaited<ReturnType<typeof seedJob>>) {
    const [pose] = await env.db
      .insert(schema.modelPoseAssets)
      .values({
        label: `Pose-sib-${Math.random().toString(36).slice(2, 8)}`,
        r2Key: 'p.jpg',
        thumbnailKey: 'p.jpg',
      })
      .returning();
    const [job] = await env.db
      .insert(schema.jobs)
      .values({ userId: base.userId, status: 'QUEUED', priority: false, creditsCharged: 1 })
      .returning();
    // biome-ignore lint/style/noNonNullAssertion: insert always returns the row
    const jobId = job!.id;
    await env.db.insert(schema.jobInputs).values({
      jobId,
      upperGarmentKey: base.rawGarmentKey,
      faceId: base.shared.faceId,
      backgroundId: base.shared.bgId,
      poseId: pose?.id,
      garmentTypeId: base.shared.garmentTypeId,
      params: {
        workflowTemplateId: base.shared.mainTemplateId,
        needsGarmentExtract: true,
        garmentExtractWorkflowTemplateId: base.shared.extractTemplateId,
        garmentExtractTemplateVersion: base.shared.extractTemplateVersion,
      },
    });
    return jobId;
  }

  async function run(jobId: string, userId: string, messageId: string) {
    await processJob(
      {
        comfyRedis: redis,
        db: env.db,
        redis,
        pub,
        storage: env.storage,
        log: createLogger('test'),
      },
      jobId,
      userId,
      'jobs:normal',
      messageId,
    );
  }

  async function dispatchEvents(jobId: string) {
    const events = await env.db
      .select()
      .from(schema.jobEvents)
      .where(
        and(eq(schema.jobEvents.jobId, jobId), eq(schema.jobEvents.eventType, 'COMFY_DISPATCH')),
      );
    return events.map((e) => e.payload as { phase?: string; inputs?: Record<string, unknown> });
  }

  const phases = (events: { phase?: string }[]) => events.map((e) => e.phase ?? 'main').sort();

  it('runs the extract phase first and feeds its output to the main workflow', async () => {
    const { jobId, userId, rawGarmentKey } = await seedJob({ extract: true });

    await run(jobId, userId, '3-1');

    const [after] = await env.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    expect(after?.status).toBe('COMPLETED');
    const events = await dispatchEvents(jobId);
    expect(phases(events)).toEqual(['garment_extract', 'main']);

    const extractKey = `outputs/${jobId}/garment-extract-intermediate.png`;
    const main = events.find((e) => (e.phase ?? 'main') === 'main');
    const r2Keys = (main?.inputs as { _r2Keys?: Record<string, unknown> } | undefined)?._r2Keys;
    expect(r2Keys?.effectiveUpperGarmentKey).toBe(extractKey);
    expect(r2Keys?.upperGarmentKey).toBe(rawGarmentKey);
    await env.s3.send(new HeadObjectCommand({ Bucket: env.r2Bucket, Key: extractKey }));

    // The attempt is recorded under its own phase, not folded into 'mannequin'.
    const attempts = await env.db
      .select({ phase: schema.executionAttempts.phase })
      .from(schema.executionAttempts)
      .where(eq(schema.executionAttempts.jobId, jobId));
    expect(attempts.map((a) => a.phase).sort()).toEqual(['garment_extract', 'main']);

    // One job, one charge: the extract phase adds no second debit or refund.
    const [balance] = await env.db
      .select()
      .from(schema.userCredits)
      .where(eq(schema.userCredits.userId, userId));
    expect(balance?.balance).toBe(5);
  }, 60_000);

  it('does not touch a job without the flag', async () => {
    const { jobId, userId, rawGarmentKey } = await seedJob({ extract: false });

    await run(jobId, userId, '3-2');

    const [after] = await env.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    expect(after?.status).toBe('COMPLETED');
    const events = await dispatchEvents(jobId);
    expect(phases(events)).toEqual(['main']);
    const r2Keys = (events[0]?.inputs as { _r2Keys?: Record<string, unknown> } | undefined)
      ?._r2Keys;
    expect(r2Keys?.effectiveUpperGarmentKey).toBe(rawGarmentKey);
  }, 60_000);

  it('runs the plain single flow, without error, when the type was disabled after the job was queued', async () => {
    const { jobId, userId, rawGarmentKey } = await seedJob({ extract: true, typeEnabled: false });

    await run(jobId, userId, '3-5');

    const [after] = await env.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    expect(after?.status).toBe('COMPLETED');
    expect(after?.errorCode).toBeNull();
    const events = await dispatchEvents(jobId);
    expect(phases(events)).toEqual(['main']);
    const r2Keys = (events[0]?.inputs as { _r2Keys?: Record<string, unknown> } | undefined)
      ?._r2Keys;
    expect(r2Keys?.effectiveUpperGarmentKey).toBe(rawGarmentKey);
  }, 60_000);

  it('extracts once per garment: the next pose reuses the first pose’s extraction', async () => {
    const first = await seedJob({ extract: true });
    const secondId = await seedSibling(first);

    await run(first.jobId, first.userId, '3-6');
    await run(secondId, first.userId, '3-7');

    for (const id of [first.jobId, secondId]) {
      const [row] = await env.db.select().from(schema.jobs).where(eq(schema.jobs.id, id));
      expect(row?.status).toBe('COMPLETED');
    }
    // One GPU extraction for the whole request; both poses still ran their own main workflow.
    expect(phases(await dispatchEvents(first.jobId))).toEqual(['garment_extract', 'main']);
    expect(phases(await dispatchEvents(secondId))).toEqual(['main']);

    // The follower holds its OWN copy, and its main run consumed it.
    const ownKey = `outputs/${secondId}/garment-extract-intermediate.png`;
    await env.s3.send(new HeadObjectCommand({ Bucket: env.r2Bucket, Key: ownKey }));
    const main = (await dispatchEvents(secondId))[0];
    const r2Keys = (main?.inputs as { _r2Keys?: Record<string, unknown> } | undefined)?._r2Keys;
    expect(r2Keys?.effectiveUpperGarmentKey).toBe(ownKey);

    const reused = await env.db
      .select()
      .from(schema.jobEvents)
      .where(
        and(
          eq(schema.jobEvents.jobId, secondId),
          eq(schema.jobEvents.eventType, 'GARMENT_EXTRACT_REUSED'),
        ),
      );
    expect(reused).toHaveLength(1);
    expect((reused[0]?.payload as { sourceJobId?: string }).sourceJobId).toBe(first.jobId);
    // No stray lock left behind once the leader finished.
    const cacheId = garmentExtractCacheId(
      first.rawGarmentKey,
      first.shared.extractTemplateId as string,
      first.shared.extractTemplateVersion as number,
    );
    expect(await redis.get(garmentExtractLockKey(cacheId))).toBeNull();
  }, 90_000);

  it('a pose that arrives while another is extracting waits for it instead of extracting again', async () => {
    const first = await seedJob({ extract: true });
    const secondId = await seedSibling(first);
    const cacheId = garmentExtractCacheId(
      first.rawGarmentKey,
      first.shared.extractTemplateId as string,
      first.shared.extractTemplateVersion as number,
    );
    // Simulate a sibling mid-extraction: it holds the lock, and publishes its result a moment later.
    await redis.set(garmentExtractLockKey(cacheId), 'other-job', 'EX', 60);
    const leaderKey = `outputs/${first.jobId}/garment-extract-intermediate.png`;
    await env.s3.send(
      new PutObjectCommand({
        Bucket: env.r2Bucket,
        Key: leaderKey,
        Body: Buffer.from('ghost'),
        ContentType: 'image/png',
      }),
    );
    const publish = setTimeout(() => {
      void redis.set(
        garmentExtractCacheKey(cacheId),
        JSON.stringify({ key: leaderKey, jobId: first.jobId, workerId: WORKER_ID }),
        'EX',
        60,
      );
    }, 3_000);

    try {
      await run(secondId, first.userId, '3-8');
    } finally {
      clearTimeout(publish);
      await redis.del(garmentExtractLockKey(cacheId));
    }

    const [row] = await env.db.select().from(schema.jobs).where(eq(schema.jobs.id, secondId));
    expect(row?.status).toBe('COMPLETED');
    expect(phases(await dispatchEvents(secondId))).toEqual(['main']);
  }, 90_000);

  it('releases the lock when the extraction cannot start, so a sibling can take over', async () => {
    const { jobId, userId, rawGarmentKey, shared } = await seedJob({ extract: true });
    await setWorkerStatus(redis, WORKER_ID, 'BUSY');

    await run(jobId, userId, '3-9');

    const cacheId = garmentExtractCacheId(
      rawGarmentKey,
      shared.extractTemplateId as string,
      shared.extractTemplateVersion as number,
    );
    expect(await redis.get(garmentExtractLockKey(cacheId))).toBeNull();
    expect(await redis.get(garmentExtractCacheKey(cacheId))).toBeNull();
  }, 30_000);

  it('requeues without consuming an attempt when no worker is free for the extract phase', async () => {
    const { jobId, userId } = await seedJob({ extract: true });
    await setWorkerStatus(redis, WORKER_ID, 'BUSY');

    await run(jobId, userId, '3-3');

    const [after] = await env.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    expect(after?.status).toBe('QUEUED');
    expect(after?.attempts).toBe(0);
    expect(after?.errorCode).toBeNull();
    expect(await dispatchEvents(jobId)).toEqual([]);
  }, 30_000);

  it('reuses an existing extract intermediate instead of re-running the GPU phase', async () => {
    const { jobId, userId } = await seedJob({ extract: true });
    await env.s3.send(
      new PutObjectCommand({
        Bucket: env.r2Bucket,
        Key: `outputs/${jobId}/garment-extract-intermediate.png`,
        Body: Buffer.from('stub'),
        ContentType: 'image/png',
      }),
    );

    await run(jobId, userId, '3-4');

    const [after] = await env.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    expect(after?.status).toBe('COMPLETED');
    expect(phases(await dispatchEvents(jobId))).toEqual(['main']);
  }, 60_000);
});
