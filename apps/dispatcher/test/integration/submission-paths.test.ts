import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { createLogger } from '@aivastra/logger';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMannequinPhase } from '../../src/job/mannequin-phase.js';
import { processJob } from '../../src/job/processor.js';
import { registerWorkers } from '../../src/worker/registry.js';
import { setupTestEnv, type TestEnv } from '../helpers/containers.js';
import { PAID_PATH_KINDS, seedPaidJob } from '../helpers/paid-jobs.js';

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

  for (const kind of PAID_PATH_KINDS) {
    it(`${kind} persists its identity, patched prompt and continuation before POST`, async () => {
      const { user, job, template, face, key, widget } = await seedPaidJob(env, kind);
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
        await processJob(cfg, job.id, widget ? '' : user.id, 'jobs:normal', id);
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
