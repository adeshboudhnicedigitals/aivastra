import { schema } from '@aivastra/db';
import { createLogger } from '@aivastra/logger';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { processJob } from '../../src/job/processor.js';
import { deregisterWorker, registerWorkers } from '../../src/worker/registry.js';
import { type ComfyMock, startComfyMock } from '../helpers/comfy-mock.js';
import { setupTestEnv, type TestEnv } from '../helpers/containers.js';
import { forceIdle } from '../helpers/workers.js';

const WORKER_ID = 'test-worker-withheld';

describe('dispatcher — output withheld by the workflow gate', () => {
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
    await forceIdle(redis, WORKER_ID);
  });

  async function seedJob() {
    const [user] = await env.db
      .insert(schema.users)
      .values({ email: `withheld-${Date.now()}@test.com`, passwordHash: 'x', tier: 'free' })
      .returning();
    // Grant 5 credits — dispatcher does NOT deduct, just refunds
    await env.db.insert(schema.userCredits).values({ userId: user?.id, balance: 5 });

    const [ct] = await env.db
      .insert(schema.catalogTypes)
      .values({ slug: `wh-${Date.now()}`, label: 'T' })
      .returning();
    const [cc] = await env.db
      .insert(schema.catalogCategories)
      .values({ typeId: ct?.id, slug: 'c', label: 'C' })
      .returning();
    const [workflow] = await env.db
      .insert(schema.workflowTemplates)
      .values({
        slug: `wh-wf-${Date.now()}`,
        label: 'Withheld test workflow',
        jsonContent: {
          f: { class_type: 'LoadImage', inputs: { image: 'x.jpg' } },
          p: { class_type: 'LoadImage', inputs: { image: 'x.jpg' } },
          b: { class_type: 'LoadImage', inputs: { image: 'x.jpg' } },
          g: { class_type: 'LoadImage', inputs: { image: 'x.jpg' } },
          out: { class_type: 'SaveImage', inputs: { images: ['f', 0] } },
        },
        workflowType: 'regular',
        resultNodeId: 'out',
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
          r2Key: 'k/m.jpg',
          thumbnailKey: 'k/m.jpg',
          faceSideR2Key: 'k/m.jpg',
        })
        .returning(),
      env.db
        .insert(schema.modelBackgrounds)
        .values({ label: 'Bg', r2Key: 'k/b.jpg', thumbnailKey: 'k/b.jpg' })
        .returning(),
      env.db
        .insert(schema.modelPoseAssets)
        .values({
          label: 'Pose',
          r2Key: 'k/p.jpg',
          thumbnailKey: 'k/p.jpg',
          workflowTemplateId: workflow?.id,
        })
        .returning(),
      env.db
        .insert(schema.catalogItems)
        .values({
          categoryId: cc?.id,
          type: 'lower',
          label: 'I',
          r2Key: 'k/l.jpg',
          thumbnailKey: 'k/l.jpg',
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
    for (const key of [
      `inputs/${job?.id}/garment.jpg`,
      'k/m.jpg',
      'k/p.jpg',
      'k/b.jpg',
      'k/l.jpg',
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
    return { jobId: job?.id, userId: user?.id };
  }

  async function run() {
    const { jobId, userId } = await seedJob();
    const cfg = {
      comfyRedis: redis,
      db: env.db,
      redis,
      pub,
      storage: env.storage,
      log: createLogger('test'),
    };
    await processJob(cfg, jobId, userId, 'jobs:normal', '1-1');
    const [job] = await env.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    return { jobId, userId, job };
  }

  // status=success, the result node 'out' was meant to run but a gate stopped it; another
  // output node ('side') did run, so `outputs` is non-empty like a real gated template.
  const withheldHistory = (promptId: string, graph: Record<string, unknown>) => ({
    status: { status_str: 'success', completed: true, messages: [] },
    outputs: { side: { images: [{ filename: 'p.png', subfolder: '', type: 'temp' }] } },
    prompt: [0, promptId, graph, {}, ['out']],
  });

  it('fails a withheld output on the first attempt, with a single refund and no retry', async () => {
    comfy.setOptions({ history: withheldHistory });
    const { jobId, userId, job } = await run();

    expect(job?.status).toBe('FAILED');
    expect(job?.attempts).toBe(1);
    expect(job?.errorCode).toBe('OUTPUT_WITHHELD');

    const ledger = await env.db
      .select()
      .from(schema.creditLedger)
      .where(eq(schema.creditLedger.jobId, jobId));
    expect(ledger.filter((e) => e.reason === 'JOB_FAIL_REFUND')).toHaveLength(1);
    const [bal] = await env.db
      .select()
      .from(schema.userCredits)
      .where(eq(schema.userCredits.userId, userId));
    expect(bal?.balance).toBe(6); // 5 initial + 1 refund
  });

  it('reports a result node missing from the workflow as a config error, also without retry', async () => {
    comfy.setOptions({
      history: (promptId) => ({
        ...withheldHistory(promptId, {}),
        prompt: [0, promptId, { side: {} }, {}, ['side']],
      }),
    });
    const { job } = await run();

    expect(job?.status).toBe('FAILED');
    expect(job?.attempts).toBe(1);
    expect(job?.errorCode).toBe('RESULT_NODE_NOT_IN_WORKFLOW');
  });

  it('treats a run that finished with no outputs at all as withheld, not a polling timeout', async () => {
    // outputs is {} — the shape when the gate stops every output node. waitForCompletion used to
    // wait for a non-empty outputs object, so this would have polled until the timeout.
    comfy.setOptions({
      history: (promptId, graph) => ({
        status: { status_str: 'success', completed: true, messages: [] },
        outputs: {},
        prompt: [0, promptId, graph, {}, ['out']],
      }),
    });
    const { job } = await run();

    expect(job?.status).toBe('FAILED');
    expect(job?.attempts).toBe(1);
    expect(job?.errorCode).toBe('OUTPUT_WITHHELD');
  });

  it('does not call a fully cached run withheld — it falls back to the generic retry', async () => {
    // Every node cached: nothing executed, outputs is empty, and the result node is in
    // execution_cached. That is not a gate decision, so it must not be blamed on the photo.
    comfy.setOptions({
      history: (promptId, graph) => ({
        status: {
          status_str: 'success',
          completed: true,
          messages: [['execution_cached', { nodes: Object.keys(graph) }]],
        },
        outputs: {},
        prompt: [0, promptId, graph, {}, ['out']],
      }),
    });
    const { job } = await run();

    expect(job?.status).toBe('QUEUED');
    expect(job?.attempts).toBe(1);
  });

  it('keeps the retry for an empty result it cannot explain', async () => {
    // No prompt graph in the history, so nothing proves the gate withheld it.
    comfy.setOptions({
      history: () => ({
        status: { status_str: 'success', completed: true, messages: [] },
        outputs: { side: { images: [{ filename: 'p.png', subfolder: '', type: 'temp' }] } },
      }),
    });
    const { job } = await run();

    expect(job?.status).toBe('QUEUED');
    expect(job?.attempts).toBe(1);
  });
});
