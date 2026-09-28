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

const WORKER_ID = 'test-worker-pose-garment-config-override';

// Regression coverage for the non-snapshot standard-tryon path
// (apps/dispatcher/src/job/processor.ts, the `else if (cfgRow?.workflowTemplateId)`
// branch): a pose_garment_configs row that redirects a pose to a DIFFERENT
// workflow than its own must not carry the pose's prompt pin along with it —
// that pin was written for the pose's own workflow's graph.
describe('dispatcher — pose_garment_configs workflow override (non-snapshot standard path)', () => {
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

  function workflowFields(
    bakedPrompt: string,
    overrides: Partial<typeof schema.workflowTemplates.$inferInsert>,
  ) {
    return {
      jsonContent: {
        f: { class_type: 'LoadImage', inputs: { image: 'x.jpg', prompt: bakedPrompt } },
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
      ...overrides,
    } as const;
  }

  async function seedJob(
    cfgFn: (ids: {
      workflowAId: string;
      workflowBId: string;
    }) => Partial<typeof schema.poseGarmentConfigs.$inferInsert>,
  ) {
    const [user] = await env.db
      .insert(schema.users)
      .values({ email: `pgc-override-${Date.now()}@test.com`, passwordHash: 'x', tier: 'free' })
      .returning();
    await env.db.insert(schema.userCredits).values({ userId: user.id, balance: 100 });

    const [workflowA] = await env.db
      .insert(schema.workflowTemplates)
      .values({
        slug: `pgc-workflow-a-${Date.now()}`,
        label: 'Workflow A (pose default)',
        ...workflowFields('BAKED-IN PROMPT FOR WORKFLOW A', {}),
      })
      .returning();
    const [workflowB] = await env.db
      .insert(schema.workflowTemplates)
      .values({
        slug: `pgc-workflow-b-${Date.now()}`,
        label: 'Workflow B (config override)',
        ...workflowFields('BAKED-IN PROMPT FOR WORKFLOW B', {}),
      })
      .returning();

    const [garmentType] = await env.db
      .insert(schema.garmentSubcategories)
      .values({
        genderSlug: 'women',
        slug: `pgc-garment-type-${Date.now()}`,
        label: 'Configured garment type',
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
      .values({ label: 'Bg', r2Key: 'b.jpg', thumbnailKey: 'b.jpg' })
      .returning();
    // Pose's own pin describes workflow A's graph — it must not leak into a job
    // dispatched against workflow B.
    const [pose] = await env.db
      .insert(schema.modelPoseAssets)
      .values({
        label: 'Pose',
        r2Key: 'p.jpg',
        thumbnailKey: 'p.jpg',
        workflowTemplateId: workflowA.id,
        promptGarmentPhase: 'POSE PIN — describes workflow A, not workflow B',
      })
      .returning();
    await env.db.insert(schema.poseGarmentConfigs).values({
      poseAssetId: pose.id,
      subcategoryId: garmentType.id,
      ...cfgFn({ workflowAId: workflowA.id, workflowBId: workflowB.id }),
    });

    const [job] = await env.db
      .insert(schema.jobs)
      .values({ userId: user.id, status: 'QUEUED', priority: false, creditsCharged: 1 })
      .returning();
    const garmentKey = `inputs/${job.id}/garment.jpg`;
    // No params.workflowTemplateId snapshot — this is the non-snapshot standard
    // path merchant-catalog jobs use (see CLAUDE.md), which is what makes the
    // dispatcher's own cfgRow lookup (not a snapshot) the thing under test.
    await env.db.insert(schema.jobInputs).values({
      jobId: job.id,
      upperGarmentKey: garmentKey,
      faceId: face.id,
      backgroundId: bg.id,
      poseId: pose.id,
      garmentTypeId: garmentType.id,
    });

    for (const key of [garmentKey, 'f.jpg', 'b.jpg', 'p.jpg']) {
      await env.s3.send(
        new PutObjectCommand({
          Bucket: env.r2Bucket,
          Key: key,
          Body: Buffer.from('stub'),
          ContentType: 'image/jpeg',
        }),
      );
    }

    return { jobId: job.id, userId: user.id, workflowA, workflowB };
  }

  async function runAndGetDispatchPayload(jobId: string, userId: string, msgId: string) {
    const log = createLogger('test');
    await processJob(
      { db: env.db, redis, pub, storage: env.storage, s3: env.s3, r2Bucket: env.r2Bucket, log },
      jobId,
      userId,
      'jobs:normal',
      msgId,
    );

    const [completedJob] = await env.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    expect(completedJob?.status).toBe('COMPLETED');

    const [dispatchEvent] = await env.db
      .select()
      .from(schema.jobEvents)
      .where(
        and(eq(schema.jobEvents.jobId, jobId), eq(schema.jobEvents.eventType, 'COMFY_DISPATCH')),
      );
    return dispatchEvent?.payload as {
      workflowTemplateId?: string;
      inputs?: { promptGarmentPhase?: string | null };
      prompt?: Record<string, { inputs?: { prompt?: string } }>;
    };
  }

  it('drops the pose pin when the config redirects to a DIFFERENT workflow with no prompt of its own', async () => {
    const { jobId, userId, workflowB } = await seedJob(({ workflowBId }) => ({
      workflowTemplateId: workflowBId,
    }));

    const payload = await runAndGetDispatchPayload(jobId, userId, '1-1');
    expect(payload.workflowTemplateId).toBe(workflowB.id);
    expect(payload.inputs?.promptGarmentPhase ?? null).toBeNull();
    // Workflow B's own baked-in prompt must survive untouched.
    expect(payload.prompt?.f?.inputs?.prompt).toBe('BAKED-IN PROMPT FOR WORKFLOW B');
  });

  it('uses the pose pin when the config has no workflow override', async () => {
    const { jobId, userId, workflowA } = await seedJob(() => ({}));

    const payload = await runAndGetDispatchPayload(jobId, userId, '1-2');
    expect(payload.workflowTemplateId).toBe(workflowA.id);
    expect(payload.inputs?.promptGarmentPhase).toBe(
      'POSE PIN — describes workflow A, not workflow B',
    );
    expect(payload.prompt?.f?.inputs?.prompt).toBe(
      'POSE PIN — describes workflow A, not workflow B',
    );
  });

  it('uses the pose pin when the config prompt is set and no workflow redirect happens', async () => {
    const { jobId, userId, workflowA } = await seedJob(() => ({
      promptGarmentPhase: 'CONFIG OWN PROMPT — no workflow redirect',
    }));

    const payload = await runAndGetDispatchPayload(jobId, userId, '1-3');
    expect(payload.workflowTemplateId).toBe(workflowA.id);
    expect(payload.inputs?.promptGarmentPhase).toBe('CONFIG OWN PROMPT — no workflow redirect');
  });
});
