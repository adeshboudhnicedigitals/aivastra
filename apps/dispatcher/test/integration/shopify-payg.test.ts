import { schema } from '@aivastra/db';
import { createLogger } from '@aivastra/logger';
import { PAYG_PRICE_PER_TRYON_USD_CENTS } from '@aivastra/types';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { processJob } from '../../src/job/processor.js';
import { deregisterWorker, registerWorkers, setWorkerStatus } from '../../src/worker/registry.js';
import { type ComfyMock, startComfyMock } from '../helpers/comfy-mock.js';
import { setupTestEnv, type TestEnv } from '../helpers/containers.js';

const WORKER_ID = 'test-worker-shopify-payg';
const PERSON_NODE_ID = '20';
const GARMENT_NODE_ID = '21';
const OUTPUT_NODE_ID = '10';

describe('dispatcher PAYG usage-event write', () => {
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
      { id: WORKER_ID, url: comfy.url, apiKey: 'test-key', allowedJobTypes: ['shopify'] },
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

  async function seedPaygShopifyJob() {
    const [store] = await env.db
      .insert(schema.shopifyStores)
      .values({
        shopDomain: `payg-dispatch-${Date.now()}.myshopify.com`,
        shopifyShopId: Date.now(),
        accessToken: 'enc',
        scope: 'read_products',
        billingMode: 'usage',
      })
      .returning();

    const [template] = await env.db
      .insert(schema.workflowTemplates)
      .values({
        slug: `payg-tpl-${Date.now()}`,
        label: 'PAYG test template',
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

    // biome-ignore lint/suspicious/noExplicitAny: db insert mocking
    const [job] = await (env.db.insert(schema.jobs).values as any)({
      shopifyStoreId: store?.id,
      customerPhotoKey: `widget-inputs/${store?.id}/photo.jpg`,
      status: 'QUEUED',
      creditsCharged: 0,
    }).returning();

    // biome-ignore lint/suspicious/noExplicitAny: db insert mocking
    await (env.db.insert(schema.jobInputs).values as any)({
      jobId: job?.id,
      upperGarmentKey: `shopify-garments/${store?.id}/garment.jpg`,
      faceId: null,
      backgroundId: null,
      poseId: null,
      params: { kind: 'shopify', workflowTemplateId: template?.id, billingMode: 'usage' },
    });

    for (const key of [
      `widget-inputs/${store?.id}/photo.jpg`,
      `shopify-garments/${store?.id}/garment.jpg`,
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

    return { jobId: job?.id as string, storeId: store?.id as string };
  }

  it('writes exactly one shopify_usage_events row on successful completion', async () => {
    const { jobId, storeId } = await seedPaygShopifyJob();
    const log = createLogger('test');

    await processJob(
      { db: env.db, redis, pub, storage: env.storage, s3: env.s3, r2Bucket: env.r2Bucket, log },
      jobId,
      '',
      'jobs:normal',
      `${Date.now()}-0`,
    );

    const [job] = await env.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    expect(job?.status).toBe('COMPLETED');

    const rows = await env.db
      .select()
      .from(schema.shopifyUsageEvents)
      .where(eq(schema.shopifyUsageEvents.jobId, jobId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.storeId).toBe(storeId);
    expect(rows[0]?.status).toBe('PENDING');
    expect(rows[0]?.priceUsdCents).toBe(PAYG_PRICE_PER_TRYON_USD_CENTS);
  });

  it('writes no usage_events row when the job fails', async () => {
    const { jobId } = await seedPaygShopifyJob();
    comfy.setOptions({ fail: true });
    const log = createLogger('test');

    await processJob(
      { db: env.db, redis, pub, storage: env.storage, s3: env.s3, r2Bucket: env.r2Bucket, log },
      jobId,
      '',
      'jobs:normal',
      `${Date.now()}-0`,
    );

    const [job] = await env.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    expect(job?.status).toBe('FAILED');

    const rows = await env.db
      .select()
      .from(schema.shopifyUsageEvents)
      .where(eq(schema.shopifyUsageEvents.jobId, jobId));
    expect(rows).toHaveLength(0);

    // PAYG jobs always have creditsCharged === 0 — the failure path must
    // never write a zero-delta JOB_FAIL_REFUND row to shopify_credit_ledger.
    // That table is prepaid-only; a PAYG store must never touch it.
    const ledgerRows = await env.db
      .select()
      .from(schema.shopifyCreditLedger)
      .where(eq(schema.shopifyCreditLedger.jobId, jobId));
    expect(ledgerRows).toHaveLength(0);
  });
});
