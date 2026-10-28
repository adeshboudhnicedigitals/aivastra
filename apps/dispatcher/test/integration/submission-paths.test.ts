import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { schema } from '@aivastra/db';
import { createLogger } from '@aivastra/logger';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMannequinPhase } from '../../src/job/mannequin-phase.js';
import { processJob } from '../../src/job/processor.js';
import { registerWorkers } from '../../src/worker/registry.js';
import { setupTestEnv, type TestEnv } from '../helpers/containers.js';

describe('intent before every paid Comfy submission path', () => {
  let env: TestEnv;
  let redis: Redis;
  let url: string;
  const workerId = `paths-${randomUUID()}`;
  const log = createLogger('submission-paths-test');
  const received: Array<Record<string, unknown>> = [];
  const server = createServer(async (req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    if (req.method === 'POST' && path === '/prompt') {
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const rows = await env.db.execute(
        sql`select * from execution_attempts where client_id = ${body.client_id}`,
      );
      received.push({ body, intent: rows[0] ?? null });
      // Stop at the submission boundary. Each route exercises its real upload,
      // patching, DB/Redis and existing failure handling, without GPU execution.
      return res.destroy();
    }
    res.setHeader('content-type', 'application/json');
    if (path === '/upload/image') return res.end(JSON.stringify({ name: 'fixture-upload.jpg' }));
    if (path === '/prompt') return res.end(JSON.stringify({ exec_info: { queue_remaining: 0 } }));
    if (path === '/queue') return res.end(JSON.stringify({ queue_running: [], queue_pending: [] }));
    return res.end('{}');
  });

  beforeAll(async () => {
    env = await setupTestEnv();
    redis = new Redis(env.redisUrl, { keyPrefix: `${workerId}:` });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing fixture worker');
    url = `http://127.0.0.1:${address.port}`;
    await env.storage.putObject(
      'inputs/paths/image.jpg',
      Buffer.from('fixture-image'),
      'image/jpeg',
    );
  }, 60_000);

  beforeEach(async () => {
    received.length = 0;
    await registerWorkers(redis, [{ id: workerId, url, apiKey: 'fixture', allowedJobTypes: [] }]);
    await redis.set(`worker:health:${workerId}`, '1');
    await redis.del('jobs:normal');
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    redis?.disconnect();
    await env?.cleanup();
  });

  for (const kind of [
    'regular',
    'tryon_direct',
    'regenerate',
    'fabric_to_garment',
    'saree_mannequin',
    'saree',
    'merchant_widget',
    'shopify',
    'in_job_mannequin',
  ]) {
    it(`${kind} persists its identity, patched prompt and continuation before POST`, async () => {
      const [user] = await env.db
        .insert(schema.users)
        .values({ email: `${randomUUID()}@test.invalid` })
        .returning();
      if (!user) throw new Error('missing user');
      await env.db.insert(schema.userCredits).values({ userId: user.id, balance: 4 });
      const graph = {
        '1': { class_type: 'LoadImage', inputs: { image: '' } },
        '2': { class_type: 'LoadImage', inputs: { image: '' } },
        '3': { class_type: 'CLIPTextEncode', inputs: { text: '' } },
        '4': { class_type: 'SaveImage', inputs: { images: ['1', 0] } },
        p: { class_type: 'LoadImage', inputs: { image: '' } },
        b: { class_type: 'LoadImage', inputs: { image: '' } },
      };
      const [template] = await env.db
        .insert(schema.workflowTemplates)
        .values({
          slug: `paths-${randomUUID()}`,
          label: 'Submission paths',
          jsonContent: graph,
          workflowType: kind === 'regular' ? 'regular' : 'tryon',
          faceNodeId: '1',
          poseNodeId: kind === 'regular' ? 'p' : '1',
          bgNodeId: 'b',
          upperNodeIds: ['2'],
          facePhasePromptNode: '3',
          garmentPhasePromptNode: '3',
          resultNodeId: '4',
          tryonPersonNodeId: '1',
          tryonGarmentNodeId: '2',
          tryonOutputNodeId: '4',
        })
        .returning();
      if (!template) throw new Error('missing template');
      const key = 'inputs/paths/image.jpg';
      const [face] = await env.db
        .insert(schema.modelFaces)
        .values({
          gender: 'women',
          label: 'Fixture',
          r2Key: key,
          thumbnailKey: key,
          faceSideR2Key: key,
        })
        .returning();
      const [bg] = await env.db
        .insert(schema.modelBackgrounds)
        .values({ label: 'Fixture', r2Key: key, thumbnailKey: key })
        .returning();
      const [pose] = await env.db
        .insert(schema.modelPoseAssets)
        .values({
          label: 'Fixture',
          r2Key: key,
          thumbnailKey: key,
          workflowTemplateId: template.id,
        })
        .returning();
      const [merchant] =
        kind === 'merchant_widget'
          ? await env.db
              .insert(schema.merchants)
              .values({
                companyName: 'Fixture',
                contactName: 'Fixture',
                phone: '0000000000',
                businessAddress: 'Fixture',
                isActive: true,
                userId: user.id,
              })
              .returning()
          : [];
      const [store] =
        kind === 'shopify'
          ? await env.db
              .insert(schema.shopifyStores)
              .values({
                shopDomain: `${randomUUID()}.myshopify.com`,
                shopifyShopId: Date.now(),
                accessToken: 'fixture',
                scope: 'read_products',
              })
              .returning()
          : [];
      const [job] = await env.db
        .insert(schema.jobs)
        .values({
          userId: merchant || store ? null : user.id,
          merchantId: merchant?.id,
          shopifyStoreId: store?.id,
          customerPhotoKey: merchant || store ? key : null,
          status: 'QUEUED',
          creditsCharged: kind === 'saree_mannequin' ? 0 : 1,
        })
        .returning();
      if (!job) throw new Error('missing job');
      const params = {
        kind,
        workflowTemplateId: template.id,
        ...(kind === 'tryon_direct' ? { personKey: key } : {}),
        ...(kind === 'regenerate' ? { sourceImageKey: key } : {}),
        ...(kind === 'fabric_to_garment' ? { prompt: 'A fixture garment' } : {}),
        ...(kind === 'saree' ? { modelKey: key } : {}),
      };
      await env.db.insert(schema.jobInputs).values({
        jobId: job.id,
        upperGarmentKey: key,
        faceId: kind === 'regular' || kind === 'saree_mannequin' ? face?.id : null,
        backgroundId: kind === 'regular' ? bg?.id : null,
        poseId: kind === 'regular' ? pose?.id : null,
        params,
      });
      const cfg = { db: env.db, redis, comfyRedis: redis, pub: redis, storage: env.storage, log };
      if (kind === 'in_job_mannequin') {
        await expect(
          runMannequinPhase(cfg, {
            jobId: job.id,
            garmentKey: key,
            faceId: face?.id ?? null,
            mannequinWorkflowTemplateId: template.id,
            jobLog: log,
            jobType: null,
          }),
        ).rejects.toThrow();
      } else {
        const id = await redis.xadd('jobs:normal', '*', 'jobId', job.id, 'userId', user.id);
        if (!id) throw new Error('missing stream entry');
        await processJob(cfg, job.id, merchant || store ? '' : user.id, 'jobs:normal', id);
      }
      expect(received, `${kind} must reach exactly one real POST`).toHaveLength(1);
      const phase =
        kind === 'saree_mannequin' || kind === 'in_job_mannequin' ? 'mannequin' : 'main';
      expect(received[0]?.intent).toMatchObject({
        job_id: job.id,
        phase,
        state: 'SUBMITTING',
        prompt_id: null,
        contract: { kind, workflowTemplateId: template.id, outputNodeId: '4' },
      });
      const body = received[0]?.body as { prompt: unknown; client_id: string };
      expect(body.client_id).toBe(`av:${job.id}:1:${phase}`);
      expect((received[0]?.intent as { contract: { prompt: unknown } }).contract.prompt).toEqual(
        body.prompt,
      );
    });
  }
});
