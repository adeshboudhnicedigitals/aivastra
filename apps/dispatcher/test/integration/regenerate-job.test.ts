import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { createLogger } from '@aivastra/logger';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { processJob } from '../../src/job/processor.js';
import { deregisterWorker, registerWorkers, setWorkerStatus } from '../../src/worker/registry.js';
import { type ComfyMock, startComfyMock } from '../helpers/comfy-mock.js';
import { setupTestEnv, type TestEnv } from '../helpers/containers.js';

const WORKER_ID = 'test-worker-regenerate';
const PERSON_NODE_ID = '151';
const PROMPT_NODE_ID = '154';
// comfy-mock's /history handler hardcodes output images under node '10'.
const OUTPUT_NODE_ID = '10';

describe('regenerate job (source=regenerate) — single-image edit, result uploaded as WebP', () => {
  let env: TestEnv;
  let redis: Redis;
  let pub: Redis;
  let comfy: ComfyMock;
  let realOutputBytes: Uint8Array;

  beforeAll(async () => {
    env = await setupTestEnv();
    redis = new Redis('redis://127.0.0.1:6379');
    pub = new Redis('redis://127.0.0.1:6379');
    comfy = await startComfyMock();

    await registerWorkers(redis, [{ id: WORKER_ID, url: comfy.url, apiKey: 'test-key' }]);
    await redis.setex(`worker:health:${WORKER_ID}`, 30, '1');

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
    comfy.setOptions({ outputBytes: realOutputBytes });
    await setWorkerStatus(redis, WORKER_ID, 'IDLE');
  });

  async function seedRegenerateJob(promptOverride?: string, instructionOverride?: string) {
    const [user] = await env.db
      .insert(schema.users)
      .values({ email: `regen-${randomUUID()}@test.com`, passwordHash: 'x', tier: 'free' })
      .returning();
    if (!user) throw new Error('failed to seed user');
    await env.db.insert(schema.userCredits).values({ userId: user.id, balance: 10 });

    const [template] = await env.db
      .insert(schema.workflowTemplates)
      .values({
        slug: `regen-tpl-${randomUUID()}`,
        label: 'Regen test template',
        jsonContent: {
          [PERSON_NODE_ID]: { inputs: { image: '' } },
          [PROMPT_NODE_ID]: { inputs: { prompt: 'default reason prompt' } },
          [OUTPUT_NODE_ID]: { class_type: 'SaveImage', inputs: {} },
        },
        faceNodeId: '',
        poseNodeId: '',
        bgNodeId: '',
        upperNodeIds: [],
        facePhasePromptNode: 'x',
        garmentPhasePromptNode: PROMPT_NODE_ID,
        workflowType: 'regeneration',
        tryonPersonNodeId: PERSON_NODE_ID,
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
        source: 'regenerate',
      })
      .returning();
    if (!job) throw new Error('failed to seed job');

    const sourceImageKey = `outputs/${randomUUID()}/result.webp`;

    // Tryon-direct/regenerate jobs are identified by shape: no faceId/
    // backgroundId/poseId, and params.kind set (see processor.ts's top-level routing).
    await env.db.insert(schema.jobInputs).values({
      jobId: job.id,
      params: {
        kind: 'regenerate',
        sourceImageKey,
        workflowTemplateId: template.id,
        ...(promptOverride ? { promptOverride } : {}),
        ...(instructionOverride ? { instructionOverride } : {}),
      },
    });

    await env.s3.send(
      new PutObjectCommand({
        Bucket: env.r2Bucket,
        Key: sourceImageKey,
        Body: Buffer.from('stub'),
        ContentType: 'image/webp',
      }),
    );

    return { jobId: job.id as string, userId: user.id as string, template };
  }

  it('uploads the result as image/webp at outputs/{jobId}/result.webp', async () => {
    const { jobId, userId } = await seedRegenerateJob();
    const log = createLogger('test');

    await processJob(
      { db: env.db, redis, pub, storage: env.storage, s3: env.s3, r2Bucket: env.r2Bucket, log },
      jobId,
      userId,
      'jobs:normal',
      `${Date.now()}-0`,
    );

    const [job] = await env.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    expect(job?.status).toBe('COMPLETED');

    const [output] = await env.db
      .select()
      .from(schema.jobOutputs)
      .where(eq(schema.jobOutputs.jobId, jobId));
    expect(output?.resultKey).toBe(`outputs/${jobId}/result.webp`);

    const obj = await env.s3.send(
      new GetObjectCommand({ Bucket: env.r2Bucket, Key: `outputs/${jobId}/result.webp` }),
    );
    expect(obj.ContentType).toBe('image/webp');
  });

  it('patches both prompt and instruction on the same reason-prompt node', async () => {
    const { jobId, userId } = await seedRegenerateJob('remove extra footwear', 'keep model shoes');
    const log = createLogger('test');

    await processJob(
      { db: env.db, redis, pub, storage: env.storage, s3: env.s3, r2Bucket: env.r2Bucket, log },
      jobId,
      userId,
      'jobs:normal',
      `${Date.now()}-0`,
    );

    const [job] = await env.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    expect(job?.status).toBe('COMPLETED');

    const submitted = comfy.lastPrompt();
    expect(submitted?.prompt[PROMPT_NODE_ID]?.inputs?.prompt).toBe('remove extra footwear');
    expect(submitted?.prompt[PROMPT_NODE_ID]?.inputs?.instruction).toBe('keep model shoes');
  });

  it('fails with REGEN_NODES_NOT_CONFIGURED when the template has no person/output node', async () => {
    const { jobId, userId, template } = await seedRegenerateJob();
    await env.db
      .update(schema.workflowTemplates)
      .set({ tryonPersonNodeId: null })
      .where(eq(schema.workflowTemplates.id, template.id));
    const log = createLogger('test');

    await processJob(
      { db: env.db, redis, pub, storage: env.storage, s3: env.s3, r2Bucket: env.r2Bucket, log },
      jobId,
      userId,
      'jobs:normal',
      `${Date.now()}-0`,
    );

    const [job] = await env.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    expect(job?.status).toBe('FAILED');
    expect(job?.errorCode).toBe('REGEN_NODES_NOT_CONFIGURED');
  });
});
