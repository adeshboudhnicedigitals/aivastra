import { schema } from '@aivastra/db';
import { createLogger } from '@aivastra/logger';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ProcessorConfig } from '../../src/job/processor.js';
import { recoverPendingJobs } from '../../src/stream/recovery.js';
import { deregisterWorker, registerWorkers, setWorkerStatus } from '../../src/worker/registry.js';
import { type ComfyMock, startComfyMock } from '../helpers/comfy-mock.js';
import { setupTestEnv, type TestEnv } from '../helpers/containers.js';

const WORKER_ID = 'test-worker-recovery-store';
const STREAM = `jobs:recovery-store-${Date.now()}`;
const GROUP = 'dispatcher-cg';

const PERSON_NODE_ID = '20';
const GARMENT_NODE_ID = '21';
// The comfy-mock's /history handler hardcodes output images under node '10'.
const OUTPUT_NODE_ID = '10';

// Store-billed Shopify jobs are enqueued with only `jobId` and `type` — no
// `userId` field, because they have no user (see customer.routes.ts). The live
// consumer path handles that (stream/loop.ts defaults userId to ''), so
// recovery must too, or a dispatcher crash silently discards the stream message
// for a job whose credits are already spent.
describe('recoverPendingJobs — store-billed jobs carry no userId field', () => {
  let env: TestEnv;
  let redis: Redis;
  let pub: Redis;
  let comfy: ComfyMock;
  let cfg: ProcessorConfig;

  beforeAll(async () => {
    env = await setupTestEnv();
    redis = new Redis('redis://127.0.0.1:6379');
    pub = new Redis('redis://127.0.0.1:6379');
    comfy = await startComfyMock();
    cfg = {
      db: env.db,
      redis,
      pub,
      storage: env.storage,
      s3: env.s3,
      r2Bucket: env.r2Bucket,
      log: createLogger('dispatcher-test'),
    };

    await registerWorkers(redis, [
      { id: WORKER_ID, url: comfy.url, apiKey: 'test-key', allowedJobTypes: ['shopify'] },
    ]);
    await redis.setex(`worker:health:${WORKER_ID}`, 30, '1');

    try {
      await redis.xgroup('CREATE', STREAM, GROUP, '$', 'MKSTREAM');
    } catch (err: unknown) {
      if (!(err instanceof Error) || !err.message.includes('BUSYGROUP')) throw err;
    }
  }, 60_000);

  afterAll(async () => {
    await deregisterWorker(redis, WORKER_ID);
    await redis.del(STREAM);
    await comfy.close();
    redis.disconnect();
    pub.disconnect();
    await env.cleanup();
  });

  async function seedShopifyJob() {
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const [store] = await env.db
      .insert(schema.shopifyStores)
      .values({
        shopDomain: `rec-store-${unique}.myshopify.com`,
        shopifyShopId: Date.now() + Math.floor(Math.random() * 1000),
        accessToken: 'iv:tag:enc',
        scope: 'read_products',
      })
      .returning();
    await env.db.insert(schema.shopifyStoreCredits).values({ storeId: store.id, balance: 10 });

    const [template] = await env.db
      .insert(schema.workflowTemplates)
      .values({
        slug: `rec-shopify-tpl-${unique}`,
        label: 'Recovery shopify template',
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

    // biome-ignore lint/suspicious/noExplicitAny: Drizzle infers non-null for nullable FKs — matches customer.routes.ts
    const [job] = await (env.db.insert(schema.jobs).values as any)({
      shopifyStoreId: store.id,
      status: 'QUEUED',
      source: 'shopify',
      creditsCharged: 2,
      customerPhotoKey: `widget-inputs/${store.id}/photo.jpg`,
    }).returning();

    // biome-ignore lint/suspicious/noExplicitAny: as above
    await (env.db.insert(schema.jobInputs).values as any)({
      jobId: job.id,
      upperGarmentKey: `shopify-garments/${store.id}/garment.jpg`,
      faceId: null,
      backgroundId: null,
      poseId: null,
      params: { kind: 'shopify', workflowTemplateId: template.id },
    });

    for (const key of [
      `widget-inputs/${store.id}/photo.jpg`,
      `shopify-garments/${store.id}/garment.jpg`,
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

    return { jobId: job.id as string, storeId: store.id as string };
  }

  /** Read the message into the group under a consumer that never ACKs it. */
  async function stranding(messageFields: string[]) {
    await redis.xadd(STREAM, '*', ...messageFields);
    await redis.xreadgroup(
      'GROUP',
      GROUP,
      'ghost-consumer',
      'COUNT',
      '1',
      'BLOCK',
      '0',
      'STREAMS',
      STREAM,
      '>',
    );
    const pending = await redis.xpending(STREAM, GROUP, '-', '+', 10);
    expect((pending as unknown[]).length).toBeGreaterThan(0);
  }

  it('reprocesses a stranded Shopify job instead of discarding its message', async () => {
    await setWorkerStatus(redis, WORKER_ID, 'IDLE');
    const { jobId } = await seedShopifyJob();

    // Exactly the fields customer.routes.ts writes — note the absent userId.
    await stranding(['jobId', jobId, 'type', 'WIDGET_TRYON']);

    await recoverPendingJobs(redis, cfg, 0, cfg.log, [STREAM]);

    const [recovered] = await env.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    expect(recovered?.status).toBe('COMPLETED');
  });

  it('still discards a malformed message with no jobId at all', async () => {
    await stranding(['type', 'WIDGET_TRYON']);

    await recoverPendingJobs(redis, cfg, 0, cfg.log, [STREAM]);

    // Nothing to reprocess and nothing left pending — the entry was ACKed away
    // rather than retried forever.
    const remaining = (await redis.xpending(STREAM, GROUP, '-', '+', 10)) as unknown[];
    expect(remaining).toHaveLength(0);
  });
});
