import { type ChildProcess, fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { schema } from '@aivastra/db';
import { createLogger } from '@aivastra/logger';
import { eq, sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runStreamLoop } from '../../src/stream/loop.js';
import { parkedCount, resetParked, startParkedScheduler } from '../../src/stream/parked.js';
import { recoverPendingJobs } from '../../src/stream/recovery.js';
import { RESERVATIONS_KEY } from '../../src/worker/registry.js';
import { rebuildWorkerRegistry } from '../../src/worker/reservation-reconciler.js';
import { type ComfyMock, startComfyMock } from '../helpers/comfy-mock.js';
import { setupTestEnv, type TestEnv } from '../helpers/containers.js';
import { ensureGroups, FAIR_STREAMS, makeReader } from '../helpers/fair-lane.js';
import { PATH_FIXTURE_KEY, seedPaidJob } from '../helpers/paid-jobs.js';

// A real dispatcher process (the production lane loop, parking and SIGTERM drain) is killed with
// waiters parked; its replacement serves them in the same order, with no second POST.
describe('fair dispatch across a restart', () => {
  let env: TestEnv;
  let redis: Redis;
  let comfy: ComfyMock;
  const log = createLogger('fair-restart-test');
  const prefix = `fairr-${randomUUID()}:`;
  const outputs = { '4': { images: [{ filename: 'result.png', subfolder: '', type: 'output' }] } };
  let children: ChildProcess[] = [];
  let stops: Array<() => void> = [];
  let testStart = new Date();

  beforeAll(async () => {
    env = await setupTestEnv();
    redis = new Redis(env.redisUrl, { keyPrefix: prefix });
    comfy = await startComfyMock();
    await env.storage.putObject(PATH_FIXTURE_KEY, Buffer.from('fixture-image'), 'image/jpeg');
  }, 60_000);
  beforeEach(async () => {
    testStart = new Date();
    comfy.resetPrompts();
    comfy.setOptions({ outputs, completionDelayMs: 600_000 });
    await env.db
      .update(schema.executionAttempts)
      .set({ resolvedAt: sql`now()` })
      .where(sql`${schema.executionAttempts.resolvedAt} is null`);
    await redis.del(RESERVATIONS_KEY, ...FAIR_STREAMS, `dispatcher:retired-consumer:${hostname()}`);
    await ensureGroups(redis, prefix);
    await env.db.delete(schema.workers);
    const rows = await env.db
      .insert(schema.workers)
      .values({
        id: `cat-${prefix}`,
        url: comfy.url,
        apiKey: 'fixture',
        isActive: true,
        allowedJobTypes: ['catalogue'],
      })
      .returning();
    await rebuildWorkerRegistry({ db: env.db, redis, log, workers: rows });
    await redis.setex(`worker:health:cat-${prefix}`, 600, '1');
  });
  afterEach(() => {
    for (const c of children) c.kill('SIGKILL');
    children = [];
    for (const stop of stops) stop();
    stops = [];
    resetParked();
  });
  afterAll(async () => {
    await comfy.close();
    redis.disconnect();
    await env?.cleanup();
  });

  async function startChild() {
    const session = randomUUID();
    const child = fork(new URL('../helpers/fair-child.ts', import.meta.url), [], {
      execArgv: ['--import', 'tsx'],
      silent: true,
      env: {
        PATH: process.env.PATH,
        NODE_ENV: 'test',
        FAIR_TEST_DATABASE_URL: env.databaseUrl,
        FAIR_TEST_REDIS_URL: env.redisUrl,
        FAIR_TEST_REDIS_PREFIX: prefix,
        FAIR_TEST_SESSION: session,
        FAIR_TEST_BUCKET: env.r2Bucket,
        FAIR_TEST_CAP: '3',
      },
    });
    children.push(child);
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    await new Promise<void>((resolve, reject) => {
      child.on('message', (m) => (m as { ready?: boolean }).ready && resolve());
      child.once('exit', () => reject(new Error('child exited before ready')));
    });
    return { child, exited };
  }

  async function enqueue(ageMin: number) {
    const { user, job } = await seedPaidJob(env, 'regular');
    await env.db
      .update(schema.jobs)
      .set({ queuedAt: new Date(Date.now() - ageMin * 60_000) })
      .where(eq(schema.jobs.id, job.id));
    await redis.xadd('jobs:normal', '*', 'jobId', job.id, 'userId', user.id);
    return job.id;
  }
  async function waitFor(check: () => boolean | Promise<boolean>, label: string, ms = 30_000) {
    const until = Date.now() + ms;
    while (!(await check())) {
      if (Date.now() >= until) throw new Error(`timed out: ${label}`);
      await new Promise((r) => setTimeout(r, 20));
    }
  }
  const posted = async () =>
    (
      await env.db.execute(
        sql`select job_id from execution_attempts where prompt_id is not null and created_at >= ${testStart.toISOString()}::timestamptz order by updated_at, created_at`,
      )
    ).map((r) => (r as { job_id: string }).job_id);
  const waitingEvents = async () =>
    (
      await env.db.execute(
        sql`select 1 from job_events where event_type = 'WAITING_FOR_WORKER' and created_at >= ${testStart.toISOString()}::timestamptz`,
      )
    ).length;
  const finishLast = () => {
    const last = comfy.accepted().at(-1);
    if (!last) throw new Error('no prompt to finish');
    comfy.finishPrompt(last.promptId, 'success');
  };

  /** The replacement dispatcher: the lane loop and scheduler in this process, plus recovery. */
  async function replacement(thresholdMs: number, expected: number) {
    const cfg = {
      db: env.db,
      redis,
      comfyRedis: redis,
      pub: redis,
      storage: env.storage,
      log,
      ownerSession: randomUUID(),
      comfyPollIntervalMs: 50,
    };
    stops.push(startParkedScheduler({ db: env.db, redis, log }));
    stops.push(
      runStreamLoop(cfg, log, {
        name: 'gpu',
        read: makeReader(redis),
        getConcurrency: async () => 3,
      }),
    );
    await waitFor(async () => {
      await recoverPendingJobs(redis, cfg, thresholdMs, log, FAIR_STREAMS, { background: true });
      return parkedCount() === expected;
    }, `replacement re-parks ${expected} waiters`);
  }

  it('fifo-survives-restart: after SIGKILL the replacement serves the waiters in the same order', async () => {
    const { child, exited } = await startChild();
    const a = await enqueue(0);
    await waitFor(async () => (await posted()).length === 1, 'first job running in the child');
    // Arrival order W1..W4; expected order is by queue time, oldest first.
    const w1 = await enqueue(2);
    const w2 = await enqueue(8);
    const w3 = await enqueue(5);
    const w4 = await enqueue(1);
    await waitFor(async () => (await waitingEvents()) === 4, 'four waiters parked in the child');

    child.kill('SIGKILL');
    await exited;
    // The killed process's leases lapse (moved, not waited out).
    await env.db.execute(
      sql`update dispatcher_job_control set lease_until = clock_timestamp() - interval '1 second'`,
    );
    await replacement(60_000, 4);

    for (let step = 2; step <= 5; step++) {
      finishLast();
      await waitFor(async () => (await posted()).length === step, `step ${step} started`);
    }
    expect(await posted()).toEqual([a, w2, w3, w1, w4]);
  }, 120_000);

  it('shutdown-with-waiters: SIGTERM exits within the drain bound and the replacement serves the waiters, no double POST', async () => {
    const { child, exited } = await startChild();
    const a = await enqueue(0);
    await waitFor(async () => (await posted()).length === 1, 'first job running in the child');
    const w1 = await enqueue(2);
    const w2 = await enqueue(6);
    await waitFor(async () => (await waitingEvents()) === 2, 'two waiters parked in the child');

    const started = Date.now();
    child.kill('SIGTERM');
    await exited;
    const took = Date.now() - started;
    // Running work gets the 5 s drain; the parked jobs add nothing to it.
    expect(took).toBeLessThan(7_500);
    const retired = await env.db.execute(
      sql`select count(*)::int as n from dispatcher_job_control where owner_retired = false and job_id in (${a}, ${w1}, ${w2})`,
    );
    expect((retired[0] as { n: number }).n).toBe(0);

    await replacement(60_000, 2);
    finishLast();
    await waitFor(async () => (await posted()).length === 2, 'oldest waiter started');
    finishLast();
    await waitFor(async () => (await posted()).length === 3, 'second waiter started');
    expect(await posted()).toEqual([a, w2, w1]);
    // Each job reached the fake worker exactly once.
    expect(comfy.accepted()).toHaveLength(3);
  }, 120_000);
});
