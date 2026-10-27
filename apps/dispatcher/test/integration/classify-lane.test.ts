import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { schema } from '@aivastra/db';
import { createLogger } from '@aivastra/logger';
import { garmentRecognitionResultKey } from '@aivastra/types';
import { eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { processRecognitionRequest } from '../../src/classify/process.js';
import { createServiceResolver } from '../../src/classify/service-config.js';
import type { ProcessorConfig } from '../../src/job/processor.js';
import { deregisterWorker, getWorkers, registerWorkers } from '../../src/worker/registry.js';
import { type ComfyMock, startComfyMock } from '../helpers/comfy-mock.js';
import { setupTestEnv, type TestEnv } from '../helpers/containers.js';

const WORKER_ID = 'classify-test-worker';
const GARMENT_KEY = 'inputs/00000000-0000-4000-8000-0000000000c1/garment.jpg';
const WORKFLOW = {
  '1': { class_type: 'LoadImage', inputs: { image: 'placeholder.png' } },
  '3': {
    class_type: 'AILab_QwenVL',
    inputs: { custom_prompt: 'Options:\n{{OPTIONS}}\nKey only.' },
  },
  '4': { class_type: 'PreviewAny', inputs: { source: ['3', 0] } },
};

describe('classify lane', () => {
  let env: TestEnv;
  let redis: Redis;
  let comfy: ComfyMock;
  let cfg: ProcessorConfig;

  const request = (over: Partial<{ expiresAt: number }> = {}) => ({
    requestId: randomUUID(),
    garmentKey: GARMENT_KEY,
    options: [
      { slug: 'wa-kurti', label: 'Kurti' },
      { slug: 'wa-full-shirt', label: 'Full shirt' },
    ],
    expiresAt: Date.now() + 8_000,
    ...over,
  });

  const worker = async (allowedJobTypes: ('classify' | 'tryon')[]) => {
    await registerWorkers(redis, [
      { id: WORKER_ID, url: comfy.url, apiKey: 'test-key', allowedJobTypes },
    ]);
    await redis.setex(`worker:health:${WORKER_ID}`, 30, '1');
  };

  beforeAll(async () => {
    env = await setupTestEnv();
    // Own key prefix: registerWorkers removes every worker it was not given, so
    // an unprefixed registry would race other dispatcher test files.
    redis = new Redis('redis://127.0.0.1:6379', { keyPrefix: `classify-lane:${randomUUID()}:` });
    comfy = await startComfyMock();
    cfg = {
      db: env.db,
      redis,
      comfyRedis: redis,
      pub: redis,
      storage: env.storage,
      s3: env.s3,
      r2Bucket: env.r2Bucket,
      log: createLogger('classify-lane-test'),
    };
    await env.storage.putObject(GARMENT_KEY, Buffer.from([0xff, 0xd8, 0xff, 0xd9]), 'image/jpeg');
    // The plan's insert omits the regular-path NOT NULL columns (pose_node_id,
    // upper_node_ids, garment_phase_prompt_node); they are unused by the
    // classify lane but the table requires them, so fill them with the same
    // dummy values other dispatcher tests use.
    await env.db.insert(schema.workflowTemplates).values({
      slug: 'garment_classify_test',
      label: 'Garment classify (test)',
      jsonContent: WORKFLOW,
      workflowType: 'classify',
      isActive: true,
      tryonPersonNodeId: '1',
      garmentPhasePromptNode: '3',
      tryonOutputNodeId: '4',
      poseNodeId: 'p',
      upperNodeIds: ['g'],
      facePhasePromptNode: 'f',
    });
  }, 60_000);

  beforeEach(async () => {
    comfy.resetPrompts();
    comfy.setOptions({ outputs: { '4': { text: ['wa-kurti'] } } });
    await worker(['classify']);
  });

  afterAll(async () => {
    await deregisterWorker(redis, WORKER_ID);
    await comfy.close();
    redis.disconnect();
    await env.cleanup();
  });

  it('answers with the model text, writes the result key and frees the worker', async () => {
    const req = request();
    const result = await processRecognitionRequest(cfg, req);
    expect(result).toMatchObject({ answer: 'wa-kurti', error: null });
    const stored = JSON.parse(
      (await redis.get(garmentRecognitionResultKey(req.requestId))) ?? '{}',
    );
    expect(stored).toMatchObject({ answer: 'wa-kurti', error: null });

    const sent = comfy.lastPrompt()?.prompt ?? {};
    // The uploaded photo, under the name the lane gave it (the mock may echo or rename it).
    expect(comfy.uploadedFilenames().at(-1)).toBe(`classify_${req.requestId}.jpg`);
    expect(sent['1']?.inputs?.image).not.toBe('placeholder.png');
    expect(sent['3']?.inputs?.custom_prompt).toBe(
      'Options:\nwa-kurti — Kurti\nwa-full-shirt — Full shirt\nKey only.',
    );
    expect((await getWorkers(redis)).get(WORKER_ID)?.status).toBe('IDLE');
  });

  // The always-resident service replaces the worker round trip entirely.
  describe('always-resident service backend', () => {
    let svc: Server;
    let svcUrl: string;
    let seen: { auth?: string; body: string }[];
    let status = 200;
    let reply: Record<string, unknown> = { answer: 'wa-kurti', ms: 900 };

    beforeAll(async () => {
      seen = [];
      svc = createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          seen.push({
            auth: req.headers.authorization,
            body: Buffer.concat(chunks).toString('utf8'),
          });
          res.writeHead(status, { 'content-type': 'application/json' });
          res.end(JSON.stringify(reply));
        });
      });
      await new Promise<void>((r) => svc.listen(0, '127.0.0.1', r));
      svcUrl = `http://127.0.0.1:${(svc.address() as AddressInfo).port}/`;
    });
    afterAll(() => new Promise<void>((r) => svc.close(() => r())));

    it('posts the filled prompt with the bearer key and never touches ComfyUI', async () => {
      status = 200;
      seen = [];
      const result = await processRecognitionRequest(cfg, request(), {
        service: { url: svcUrl, apiKey: 'svc-key' },
      });
      expect(result).toMatchObject({ answer: 'wa-kurti', error: null });
      expect(seen[0]?.auth).toBe('Bearer svc-key');
      // multipart form text carries CRLF; the service normalizes it back.
      expect(seen[0]?.body).toContain('Options:\r\nwa-kurti — Kurti');
      expect(comfy.lastPrompt()).toBeNull();
      // The keys the scored service ranks as a closed set.
      expect(seen[0]?.body).toContain('["wa-kurti","wa-full-shirt"]');
      // The plain server ranks nothing, so the result has no ranking.
      expect(result.ranked).toBeUndefined();
    });

    it('passes the scored service ranking through, best first, and records it', async () => {
      status = 200;
      reply = {
        answer: 'wa-kurti',
        ranked: [{ slug: 'wa-full-shirt', p: 0.2 }, { slug: 'wa-kurti', p: 0.8 }, { slug: 'bad' }],
        ms: 120,
      };
      try {
        const req = request();
        const result = await processRecognitionRequest(cfg, req, {
          service: { url: svcUrl, apiKey: 'svc-key' },
        });
        const ranked = [
          { slug: 'wa-kurti', p: 0.8 },
          { slug: 'wa-full-shirt', p: 0.2 },
        ];
        expect(result.ranked).toEqual(ranked);
        const [row] = await env.db
          .select({ ranked: schema.garmentRecognitions.ranked })
          .from(schema.garmentRecognitions)
          .where(eq(schema.garmentRecognitions.id, req.requestId));
        expect(row?.ranked).toEqual(ranked);
      } finally {
        reply = { answer: 'wa-kurti', ms: 900 };
      }
    });

    it('a service error is failed, not thrown', async () => {
      status = 500;
      const result = await processRecognitionRequest(cfg, request(), {
        service: { url: svcUrl, apiKey: 'svc-key' },
      });
      expect(result.error).toBe('failed');
    });
  });

  it('the service resolver prefers the saved row, falls back to env, and caches', async () => {
    const envCfg = { CLASSIFY_SERVICE_URL: 'http://env-host', CLASSIFY_SERVICE_API_KEY: 'env-key' };
    const resolve = createServiceResolver(env.db, envCfg, 0);
    expect(await resolve()).toEqual({ url: 'http://env-host', apiKey: 'env-key' });
    expect(await createServiceResolver(env.db, {}, 0)()).toBeUndefined();

    await env.db
      .insert(schema.classifyServiceConfig)
      .values({ id: 'default', url: 'http://db-host', apiKey: 'db-key' });
    try {
      expect(await resolve()).toEqual({ url: 'http://db-host', apiKey: 'db-key' });
      // a long ttl keeps the first answer even after the row is removed
      const cached = createServiceResolver(env.db, envCfg, 60_000);
      await cached();
      await env.db.delete(schema.classifyServiceConfig);
      expect(await cached()).toEqual({ url: 'http://db-host', apiKey: 'db-key' });
    } finally {
      await env.db.delete(schema.classifyServiceConfig);
    }
  });

  it('a request past its deadline is skipped without touching a GPU', async () => {
    const result = await processRecognitionRequest(cfg, request({ expiresAt: Date.now() - 1 }));
    expect(result.error).toBe('expired');
    expect(comfy.lastPrompt()).toBeNull();
  });

  it('an empty allowed list includes classify; a list without it does not (D52)', async () => {
    await worker(['tryon']);
    expect((await processRecognitionRequest(cfg, request())).error).toBe('no_worker');
    expect(comfy.lastPrompt()).toBeNull();
    await worker([]);
    expect((await processRecognitionRequest(cfg, request())).error).toBeNull();
  });

  it('a ComfyUI error is failed, and the worker is still released', async () => {
    comfy.setOptions({ fail: true });
    expect((await processRecognitionRequest(cfg, request())).error).toBe('failed');
    expect((await getWorkers(redis)).get(WORKER_ID)?.status).toBe('IDLE');
  });

  it('no active classify workflow is failed', async () => {
    await env.db
      .update(schema.workflowTemplates)
      .set({ isActive: false })
      .where(eq(schema.workflowTemplates.slug, 'garment_classify_test'));
    try {
      expect((await processRecognitionRequest(cfg, request())).error).toBe('failed');
    } finally {
      await env.db
        .update(schema.workflowTemplates)
        .set({ isActive: true })
        .where(eq(schema.workflowTemplates.slug, 'garment_classify_test'));
    }
  });

  // D54: one garment_recognitions row per request, best effort.
  it('writes one garment_recognitions row per answered request', async () => {
    const req = { ...request(), gender: 'women' };
    const result = await processRecognitionRequest(cfg, req);
    expect(result.error).toBeNull();

    const rows = await env.db
      .select()
      .from(schema.garmentRecognitions)
      .where(eq(schema.garmentRecognitions.id, req.requestId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: req.requestId,
      gender: 'women',
      garmentKey: GARMENT_KEY,
      answer: 'wa-kurti',
      outcome: 'answered',
      workerId: WORKER_ID,
    });
    // The exact options as sent, so admin shows what the model chose from.
    expect(rows[0]?.options).toEqual(req.options);
    expect(rows[0]?.ms).toBeGreaterThanOrEqual(0);
    expect(rows[0]?.workflowTemplateId).toEqual(expect.any(String));
  });

  it('records the outcome on paths that never reach the GPU', async () => {
    const expired = request({ expiresAt: Date.now() - 1 });
    expect((await processRecognitionRequest(cfg, expired)).error).toBe('expired');
    const [expiredRow] = await env.db
      .select()
      .from(schema.garmentRecognitions)
      .where(eq(schema.garmentRecognitions.id, expired.requestId));
    expect(expiredRow?.outcome).toBe('expired');
    expect(expiredRow?.workerId).toBeNull();

    await worker(['tryon']);
    const starved = request();
    expect((await processRecognitionRequest(cfg, starved)).error).toBe('no_worker');
    const [starvedRow] = await env.db
      .select()
      .from(schema.garmentRecognitions)
      .where(eq(schema.garmentRecognitions.id, starved.requestId));
    expect(starvedRow?.outcome).toBe('no_worker');
    expect(starvedRow?.workerId).toBeNull();
  });

  it('still answers when the record insert fails (best effort, D54)', async () => {
    const req = { ...request(), gender: 'women' };
    // select works (the template must load); only the record insert throws.
    const throwingDb = new Proxy(cfg.db, {
      get(target, prop) {
        if (prop === 'insert') {
          return () => {
            throw new Error('recognition record boom');
          };
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const result = await processRecognitionRequest({ ...cfg, db: throwingDb }, req);
    expect(result).toMatchObject({ answer: 'wa-kurti', error: null });
    const stored = JSON.parse(
      (await redis.get(garmentRecognitionResultKey(req.requestId))) ?? '{}',
    );
    expect(stored).toMatchObject({ answer: 'wa-kurti', error: null });
    expect(
      await env.db
        .select()
        .from(schema.garmentRecognitions)
        .where(eq(schema.garmentRecognitions.id, req.requestId)),
    ).toHaveLength(0);
  });
});
