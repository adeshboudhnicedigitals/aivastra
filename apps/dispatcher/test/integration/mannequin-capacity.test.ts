import { schema } from '@aivastra/db';
import { createLogger } from '@aivastra/logger';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { and, eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { processJob } from '../../src/job/processor.js';
import { deregisterWorker, registerWorkers, setWorkerStatus } from '../../src/worker/registry.js';
import { type ComfyMock, startComfyMock } from '../helpers/comfy-mock.js';
import { setupTestEnv, type TestEnv } from '../helpers/containers.js';

const WORKER_ID = 'test-worker-mannequin-capacity';
const HOUR = 60 * 60 * 1000;

/**
 * Mannequin-phase "no worker" is capacity, not failure: it must requeue (or terminate
 * with NO_WORKER past MAX_QUEUE_WAIT_MS) without consuming `attempts`, and a finished
 * mannequin intermediate in storage must be reused instead of re-running the GPU phase.
 */
describe('dispatcher — mannequin phase capacity handling', () => {
  let env: TestEnv;
  let redis: Redis;
  let pub: Redis;
  let comfy: ComfyMock;

  beforeAll(async () => {
    env = await setupTestEnv();
    redis = new Redis('redis://127.0.0.1:6379');
    pub = new Redis('redis://127.0.0.1:6379');
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
    comfy.setOptions({});
    await setWorkerStatus(redis, WORKER_ID, 'IDLE');
  });

  async function seedJob(createdAt: Date) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const [user] = await env.db
      .insert(schema.users)
      .values({ email: `mq-cap-${suffix}@test.com`, passwordHash: 'x', tier: 'free' })
      .returning();
    // biome-ignore lint/style/noNonNullAssertion: insert always returns the row
    const userId = user!.id;
    await env.db.insert(schema.userCredits).values({ userId, balance: 5 });

    const [mannequinTemplate] = await env.db
      .insert(schema.workflowTemplates)
      .values({
        slug: `mq-cap-step1-${suffix}`,
        label: 'Cap Step1',
        jsonContent: {
          '1': { class_type: 'LoadImage', inputs: { image: 'placeholder.jpg' } },
          '2': { class_type: 'LoadImage', inputs: { image: 'placeholder.jpg' } },
        },
        workflowType: 'saree_step1',
        faceNodeId: '',
        poseNodeId: '',
        bgNodeId: '',
        upperNodeIds: [],
        facePhasePromptNode: '',
        garmentPhasePromptNode: '',
        tryonPersonNodeId: '1',
        tryonGarmentNodeId: '2',
        tryonOutputNodeId: '10',
      })
      .returning();
    const [step2Template] = await env.db
      .insert(schema.workflowTemplates)
      .values({
        slug: `mq-cap-step2-${suffix}`,
        label: 'Cap Step2',
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
        slug: `mq-cap-saree-${suffix}`,
        label: 'Cap Saree',
        requiresMannequinStep: true,
        mannequinWorkflowTemplateId: mannequinTemplate?.id,
        sareeStep2WorkflowTemplateId: step2Template?.id,
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
      .values({ userId, status: 'QUEUED', priority: false, creditsCharged: 1, createdAt })
      .returning();
    // biome-ignore lint/style/noNonNullAssertion: insert always returns the row
    const jobId = job!.id;
    const rawGarmentKey = `merchant-catalog/flat/${jobId}/garment.jpg`;
    await env.db.insert(schema.jobInputs).values({
      jobId,
      upperGarmentKey: rawGarmentKey,
      faceId: face?.id,
      backgroundId: bg?.id,
      poseId: pose?.id,
      garmentTypeId: garmentType?.id,
      params: { kind: 'merchant_catalog', needsMannequinStep: true },
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
    return { jobId, userId };
  }

  async function run(jobId: string, userId: string, messageId: string) {
    await processJob(
      {
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
      messageId,
    );
  }

  async function dispatchPhases(jobId: string) {
    const events = await env.db
      .select()
      .from(schema.jobEvents)
      .where(
        and(eq(schema.jobEvents.jobId, jobId), eq(schema.jobEvents.eventType, 'COMFY_DISPATCH')),
      );
    return events.map((e) => (e.payload as { phase?: string }).phase ?? 'main');
  }

  it('requeues without consuming an attempt when no worker is free for the mannequin phase', async () => {
    const { jobId, userId } = await seedJob(new Date());
    await setWorkerStatus(redis, WORKER_ID, 'BUSY');

    await run(jobId, userId, '2-1');

    const [after] = await env.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    expect(after?.status).toBe('QUEUED');
    expect(after?.attempts).toBe(0);
    expect(after?.errorCode).toBeNull();
    expect(await dispatchPhases(jobId)).toEqual([]);
    const [balance] = await env.db
      .select()
      .from(schema.userCredits)
      .where(eq(schema.userCredits.userId, userId));
    expect(balance?.balance).toBe(5);
  }, 30_000);

  it('terminates with NO_WORKER and refunds once past the max queue wait', async () => {
    const { jobId, userId } = await seedJob(new Date(Date.now() - 4 * HOUR));
    await setWorkerStatus(redis, WORKER_ID, 'BUSY');

    await run(jobId, userId, '2-2');

    const [after] = await env.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    expect(after?.status).toBe('FAILED');
    expect(after?.errorCode).toBe('NO_WORKER');
    const [balance] = await env.db
      .select()
      .from(schema.userCredits)
      .where(eq(schema.userCredits.userId, userId));
    expect(balance?.balance).toBe(6);
  }, 30_000);

  it('reuses an existing mannequin intermediate instead of re-running the GPU phase', async () => {
    const { jobId, userId } = await seedJob(new Date());
    await env.s3.send(
      new PutObjectCommand({
        Bucket: env.r2Bucket,
        Key: `outputs/${jobId}/mannequin-intermediate.png`,
        Body: Buffer.from('stub'),
        ContentType: 'image/png',
      }),
    );

    await run(jobId, userId, '2-3');

    const [after] = await env.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    expect(after?.status).toBe('COMPLETED');
    // Only the main step-2 prompt was submitted — no mannequin-phase dispatch.
    expect(await dispatchPhases(jobId)).toEqual(['main']);
  }, 60_000);

  it('runs the mannequin phase when no intermediate exists yet', async () => {
    const { jobId, userId } = await seedJob(new Date());

    await run(jobId, userId, '2-4');

    const [after] = await env.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    expect(after?.status).toBe('COMPLETED');
    expect((await dispatchPhases(jobId)).sort()).toEqual(['main', 'mannequin']);
  }, 60_000);
});
