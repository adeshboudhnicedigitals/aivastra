import { type ChildProcess, fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { createLogger } from '@aivastra/logger';
import { eq, sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { processJob } from '../../src/job/processor.js';
import { deregisterWorker, registerWorkers } from '../../src/worker/registry.js';
import { type ComfyMock, startComfyMock } from '../helpers/comfy-mock.js';
import { setupTestEnv, type TestEnv } from '../helpers/containers.js';
import { PATH_FIXTURE_KEY, seedPaidJob } from '../helpers/paid-jobs.js';

// Real SIGTERM and SIGKILL to a separate dispatcher process. The fake worker lives in
// this (parent) process, so its queue and request counters survive every child kill.
// No signal handler is installed in the child, matching today's shutdown(): it
// exits at once with no drain (Phase E adds one).
describe('owner process death', () => {
  let env: TestEnv;
  let redis: Redis;
  let comfy: ComfyMock;
  const log = createLogger('ownership-process-test');
  const workerId = `own-proc-${randomUUID()}`;
  const prefix = `${workerId}:`;
  const children = new Set<ChildProcess>();

  let posts = 0;
  let uploadGate: { seen: Promise<void>; hit: () => void; open: Promise<void> } | null = null;

  beforeAll(async () => {
    env = await setupTestEnv();
    redis = new Redis(env.redisUrl, { keyPrefix: prefix });
    comfy = await startComfyMock();
    await env.storage.putObject(PATH_FIXTURE_KEY, Buffer.from('fixture-image'), 'image/jpeg');
  }, 60_000);
  beforeEach(async () => {
    posts = 0;
    uploadGate = null;
    await registerWorkers(redis, [
      { id: workerId, url: comfy.url, apiKey: 'fixture', allowedJobTypes: [] },
    ]);
    await redis.setex(`worker:health:${workerId}`, 120, '1');
  });
  afterEach(() => {
    for (const child of children) child.kill('SIGKILL');
    children.clear();
  });
  afterAll(async () => {
    await deregisterWorker(redis, workerId);
    await comfy.close();
    redis.disconnect();
    await env?.cleanup();
  });

  function armUploadGate() {
    let hit!: () => void;
    const seen = new Promise<void>((r) => {
      hit = r;
    });
    // Never released: the parked upload belongs to a process that is about to die.
    uploadGate = { seen, hit, open: new Promise<void>(() => {}) };
    return uploadGate;
  }

  function startOwner(jobId: string, userId: string, messageId: string, session: string) {
    const child = fork(new URL('../helpers/ownership-child.ts', import.meta.url), [], {
      execArgv: ['--import', 'tsx'],
      silent: true,
      env: {
        PATH: process.env.PATH,
        NODE_ENV: 'test',
        OWN_TEST_DATABASE_URL: env.databaseUrl,
        OWN_TEST_REDIS_URL: env.redisUrl,
        OWN_TEST_REDIS_PREFIX: prefix,
        OWN_TEST_BUCKET: env.r2Bucket,
        OWN_TEST_SESSION: session,
        OWN_TEST_JOB_ID: jobId,
        OWN_TEST_USER_ID: userId,
        OWN_TEST_MESSAGE_ID: messageId,
      },
    });
    children.add(child);
    return child;
  }
  async function stopChild(child: ChildProcess, signal: 'SIGTERM' | 'SIGKILL') {
    const ended = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    child.kill(signal);
    await ended;
  }
  async function waitFor(check: () => boolean | Promise<boolean>) {
    const until = Date.now() + 20_000;
    while (!(await check())) {
      if (Date.now() >= until) throw new Error('fixture gate timed out');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  const jobRow = async (id: string) =>
    (await env.db.select().from(schema.jobs).where(eq(schema.jobs.id, id)))[0];
  const control = async (id: string) =>
    (
      await env.db.execute(
        sql`select owner_session, generation::int as generation, owner_retired, lease_until > clock_timestamp() as live from dispatcher_job_control where job_id = ${id}`,
      )
    )[0];
  const attempts = (jobId: string) =>
    env.db.execute(
      sql`select state, resolved_at is not null as resolved from execution_attempts where job_id = ${jobId} order by attempt_no`,
    );

  async function seed() {
    const { user, job } = await seedPaidJob(env, 'regular');
    const id = await redis.xadd('jobs:normal', '*', 'jobId', job.id, 'userId', user.id);
    if (!id) throw new Error('missing stream entry');
    return { user, job, id };
  }
  const replacementProcess = (jobId: string, userId: string, messageId: string) =>
    processJob(
      {
        db: env.db,
        redis,
        comfyRedis: redis,
        pub: redis,
        storage: env.storage,
        log,
        ownerSession: randomUUID(),
      },
      jobId,
      userId,
      'jobs:normal',
      messageId,
    );

  for (const signal of ['SIGTERM', 'SIGKILL'] as const) {
    it(`${signal} during upload: the live lease is respected, then recovery runs under a fresh generation`, async () => {
      comfy.setOptions({
        fail: true,
        onRequest: async (method, path) => {
          if (method === 'POST' && path === '/prompt') posts++;
          if (method === 'POST' && path === '/upload/image' && uploadGate) {
            uploadGate.hit();
            await uploadGate.open;
          }
        },
      });
      const { user, job, id } = await seed();
      const gate = armUploadGate();
      const child = startOwner(job.id, user.id, id, randomUUID());
      await gate.seen;
      await stopChild(child, signal);

      // The dead owner's lease has not expired: a restarted dispatcher must not touch it.
      expect((await control(job.id))?.live).toBe(true);
      await replacementProcess(job.id, user.id, id);
      expect(await jobRow(job.id)).toMatchObject({ status: 'PREPROCESSING', attempts: 0 });
      expect(posts).toBe(0);

      // Lease expiry is simulated on Postgres time; waiting the real 30s adds no coverage.
      await env.db.execute(
        sql`update dispatcher_job_control set lease_until = clock_timestamp() - interval '1 second' where job_id = ${job.id}`,
      );
      await replacementProcess(job.id, user.id, id);
      expect(await jobRow(job.id)).toMatchObject({ status: 'QUEUED', attempts: 1 });
      expect(await control(job.id)).toMatchObject({ generation: 2, owner_retired: true });
      expect(posts).toBe(0);
    }, 60_000);

    it(`${signal} after acceptance: same policy, and the accepted attempt is marked FAILED when requeued`, async () => {
      comfy.setOptions({
        fail: true,
        completionDelayMs: 60_000,
        onRequest: async (method, path) => {
          if (method === 'POST' && path === '/prompt') posts++;
        },
      });
      const { user, job, id } = await seed();
      const child = startOwner(job.id, user.id, id, randomUUID());
      await waitFor(async () => (await attempts(job.id)).some((r) => r.state === 'ACCEPTED'));
      await stopChild(child, signal);

      expect((await control(job.id))?.live).toBe(true);
      await replacementProcess(job.id, user.id, id);
      expect(await jobRow(job.id)).toMatchObject({ status: 'GENERATING', attempts: 0 });

      await env.db.execute(
        sql`update dispatcher_job_control set lease_until = clock_timestamp() - interval '1 second' where job_id = ${job.id}`,
      );
      await replacementProcess(job.id, user.id, id);
      expect(await jobRow(job.id)).toMatchObject({ status: 'QUEUED', attempts: 1 });
      expect(await attempts(job.id)).toEqual([{ state: 'FAILED', resolved: false }]);
      expect(posts).toBe(1);
    }, 60_000);
  }
});
