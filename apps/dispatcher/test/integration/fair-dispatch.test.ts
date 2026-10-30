import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { schema } from '@aivastra/db';
import { createLogger } from '@aivastra/logger';
import { eq, inArray, sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { processJob } from '../../src/job/processor.js';
import { runStreamLoop } from '../../src/stream/loop.js';
import {
  parkedCount,
  parkedJobIds,
  resetParked,
  setMaxParkedForTest,
  startParkedScheduler,
} from '../../src/stream/parked.js';
import { recoverPendingJobs } from '../../src/stream/recovery.js';
import { RESERVATIONS_KEY } from '../../src/worker/registry.js';
import { rebuildWorkerRegistry } from '../../src/worker/reservation-reconciler.js';
import * as selector from '../../src/worker/selector.js';
import { type ComfyMock, startComfyMock } from '../helpers/comfy-mock.js';
import { setupTestEnv, type TestEnv } from '../helpers/containers.js';
import { ensureGroups, FAIR_STREAMS, makeReader } from '../helpers/fair-lane.js';
import { PATH_FIXTURE_KEY, type PaidPathKind, seedPaidJob } from '../helpers/paid-jobs.js';

// Phase G: a job with no worker parks instead of holding a lane slot, waiting jobs get workers
// in arrival order, and a freed worker is offered to the oldest waiter within about a second.
// Real Postgres/Redis/MinIO, the production lane loop and scheduler, and a fake worker.
describe('fair dispatch', () => {
  let env: TestEnv;
  let redis: Redis;
  let comfy: ComfyMock;
  const log = createLogger('fair-dispatch-test');
  const prefix = `fair-${randomUUID()}:`;
  const outputs = { '4': { images: [{ filename: 'result.png', subfolder: '', type: 'output' }] } };
  let stops: Array<() => void> = [];
  // Attempts, uploads and prompts are counted from the start of each test: the database and the
  // fake worker are shared by the whole file.
  let testStart = new Date();
  let uploadsAtStart = 0;

  beforeAll(async () => {
    env = await setupTestEnv();
    redis = new Redis(env.redisUrl, { keyPrefix: prefix });
    comfy = await startComfyMock();
    await env.storage.putObject(PATH_FIXTURE_KEY, Buffer.from('fixture-image'), 'image/jpeg');
  }, 60_000);
  beforeEach(async () => {
    testStart = new Date();
    comfy.resetPrompts();
    uploadsAtStart = comfy.uploadedFilenames().length;
    comfy.setOptions({ outputs, completionDelayMs: 600_000 });
    await env.db
      .update(schema.executionAttempts)
      .set({ resolvedAt: sql`now()` })
      .where(sql`${schema.executionAttempts.resolvedAt} is null`);
    await redis.del(RESERVATIONS_KEY, ...FAIR_STREAMS);
    await ensureGroups(redis, prefix);
  });
  afterEach(() => {
    for (const stop of stops) stop();
    stops = [];
    resetParked();
  });
  afterAll(async () => {
    await comfy.close();
    redis.disconnect();
    await env?.cleanup();
  });

  async function setWorkers(spec: Array<{ id: string; pools: string[] }>) {
    await env.db.delete(schema.workers);
    const rows = await env.db
      .insert(schema.workers)
      .values(
        spec.map((w) => ({
          id: `${w.id}-${prefix}`,
          url: comfy.url,
          apiKey: 'fixture',
          isActive: true,
          allowedJobTypes: w.pools,
        })),
      )
      .returning();
    await rebuildWorkerRegistry({ db: env.db, redis, log, workers: rows });
    for (const w of rows) await redis.setex(`worker:health:${w.id}`, 600, '1');
    return rows.map((r) => r.id);
  }

  const cfg = () => ({
    db: env.db,
    redis,
    comfyRedis: redis,
    pub: redis,
    storage: env.storage,
    log,
    ownerSession: randomUUID(),
    comfyPollIntervalMs: 50,
  });

  /** The production lane loop and scheduler over the three job streams. */
  function startLane(cap: number) {
    const lane = cfg();
    stops.push(startParkedScheduler({ db: env.db, redis, log }));
    stops.push(
      runStreamLoop(lane, log, {
        name: 'gpu',
        read: makeReader(redis),
        getConcurrency: async () => cap,
      }),
    );
  }

  async function enqueue(
    kind: PaidPathKind,
    opts: { stream?: (typeof FAIR_STREAMS)[number]; ageMin?: number; leading?: string[] } = {},
  ) {
    const { user, job } = await seedPaidJob(env, kind);
    await env.db
      .update(schema.jobs)
      .set({ queuedAt: new Date(Date.now() - (opts.ageMin ?? 0) * 60_000) })
      .where(eq(schema.jobs.id, job.id));
    await redis.xadd(
      opts.stream ?? 'jobs:normal',
      '*',
      ...(opts.leading ?? []),
      'jobId',
      job.id,
      ...(kind === 'shopify' ? [] : ['userId', user.id]),
    );
    return { user, job };
  }

  async function waitFor(check: () => boolean | Promise<boolean>, label: string, ms = 20_000) {
    const until = Date.now() + ms;
    while (!(await check())) {
      if (Date.now() >= until) throw new Error(`timed out: ${label}`);
      await new Promise((r) => setTimeout(r, 10));
    }
  }
  /** Job ids in the order the fake worker accepted their prompts. */
  const posted = async () =>
    (
      await env.db.execute(
        sql`select job_id from execution_attempts where prompt_id is not null and created_at >= ${testStart.toISOString()}::timestamptz order by updated_at, created_at`,
      )
    ).map((r) => (r as { job_id: string }).job_id);
  const finishLast = () => {
    const last = comfy.accepted().at(-1);
    if (!last) throw new Error('no prompt to finish');
    comfy.finishPrompt(last.promptId, 'success');
  };
  const jobRow = async (id: string) =>
    (await env.db.select().from(schema.jobs).where(eq(schema.jobs.id, id)))[0];
  const eventCount = async (jobId: string, type: string) =>
    (
      await env.db
        .select()
        .from(schema.jobEvents)
        .where(
          sql`${schema.jobEvents.jobId} = ${jobId} and ${schema.jobEvents.eventType} = ${type}`,
        )
    ).length;
  const quantile = (xs: number[], q: number) =>
    [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(q * xs.length))] as number;

  it('waiting-job-frees-slot: jobs waiting for a busy pool do not block a job that can run now', async () => {
    await setWorkers([
      { id: 'cat', pools: ['catalogue'] },
      { id: 'mer', pools: ['merchant'] },
    ]);
    startLane(2);
    const running = await enqueue('regular');
    await waitFor(async () => (await posted()).length === 1, 'catalogue job running');
    // Two more catalogue jobs: no worker, so they park. Before Phase G each held a slot.
    await enqueue('regular');
    await enqueue('regular');
    await waitFor(() => parkedCount() === 2, 'two parked');

    const latencies: number[] = [];
    for (let i = 0; i < 30; i++) {
      const before = (await posted()).length;
      const t0 = performance.now();
      const m = await enqueue('merchant_widget');
      await waitFor(async () => (await posted()).length > before, 'merchant prompt posted', 5_000);
      latencies.push(performance.now() - t0);
      finishLast();
      await waitFor(async () => (await jobRow(m.job.id))?.status === 'COMPLETED', 'merchant done');
    }
    console.info(
      `waiting-job-frees-slot: ${latencies.length} merchant jobs, enqueue -> POST p50 ${quantile(latencies, 0.5).toFixed(0)} ms, p95 ${quantile(latencies, 0.95).toFixed(0)} ms`,
    );
    expect(quantile(latencies, 0.95)).toBeLessThan(1_000);
    expect((await jobRow(running.job.id))?.status).not.toBe('FAILED');
  }, 120_000);

  it('waiting-bound: a flood for a pool with no worker never reads past the bound', async () => {
    await setWorkers([{ id: 'cat', pools: ['catalogue'] }]);
    setMaxParkedForTest(3);
    startLane(2);
    for (let i = 0; i < 8; i++) await enqueue('tryon_direct');
    await waitFor(() => parkedCount() === 3, 'bound reached');
    await new Promise((r) => setTimeout(r, 1_000));
    expect(parkedCount()).toBe(3);
    // Delivered to this consumer: exactly the bound. The other five are still unread.
    const [pending] = (await redis.xpending('jobs:normal', 'dispatcher-cg')) as [number];
    expect(pending).toBe(3);
    expect(await redis.xlen('jobs:normal')).toBe(8);
  }, 60_000);

  it('pool-fifo: waiters get the worker in priority, then queue-time order, not re-add order', async () => {
    await setWorkers([{ id: 'cat', pools: ['catalogue'] }]);
    startLane(3);
    const a = await enqueue('regular');
    await waitFor(async () => (await posted()).length === 1, 'first job running');
    // Arrival order W1..W5 differs from the expected order on purpose.
    const w1 = await enqueue('regular', { ageMin: 1 });
    const w2 = await enqueue('regular', { ageMin: 5 });
    const w3 = await enqueue('regular', { stream: 'jobs:priority', ageMin: 2 });
    const w4 = await enqueue('regular', { stream: 'jobs:low', ageMin: 10 });
    const w5 = await enqueue('regular', { ageMin: 3 });
    await waitFor(() => parkedCount() === 5, 'five parked');

    const startedAfterRelease: number[] = [];
    for (let step = 1; step <= 5; step++) {
      const t0 = performance.now();
      finishLast();
      await waitFor(
        async () => (await posted()).length === step + 1,
        `step ${step} started`,
        8_000,
      );
      startedAfterRelease.push(performance.now() - t0);
    }
    const order = (await posted()).slice(1);
    expect(order).toEqual([w3, w2, w5, w1, w4].map((w) => w.job.id));
    console.info(
      `pool-fifo: release -> next POST ms ${startedAfterRelease.map((n) => n.toFixed(0)).join(', ')} (includes the finishing job's completion)`,
    );
    expect(Math.max(...startedAfterRelease)).toBeLessThan(2_000);
    expect((await posted())[0]).toBe(a.job.id);
  }, 120_000);

  it('probe-cost: ten waiters on one busy worker cause no ComfyUI queue probes', async () => {
    await setWorkers([{ id: 'cat', pools: ['catalogue'] }]);
    let queueProbes = 0;
    comfy.setOptions({
      outputs,
      completionDelayMs: 600_000,
      onRequest: (method, path) => {
        if (method === 'GET' && path === '/queue') queueProbes++;
      },
    });
    startLane(3);
    await enqueue('regular');
    await waitFor(async () => (await posted()).length === 1, 'first job running');
    for (let i = 0; i < 10; i++) await enqueue('regular', { ageMin: i + 1 });
    await waitFor(() => parkedCount() === 10, 'ten parked');
    queueProbes = 0;
    const started = Date.now();
    await new Promise((r) => setTimeout(r, 5_000));
    // The claim fails on the busy worker before any probe: waiting costs a Redis check per
    // second per pool and nothing on the worker.
    console.info(
      `probe-cost: ${queueProbes} ComfyUI /queue probes in ${((Date.now() - started) / 1000).toFixed(1)} s with 10 waiters`,
    );
    expect(queueProbes).toBe(0);
    expect(parkedCount()).toBe(10);
  }, 60_000);

  it('cross-pool-order: one freed worker serving two pools goes to the oldest waiter', async () => {
    await setWorkers([{ id: 'both', pools: ['merchant', 'shopify'] }]);
    startLane(3);
    await enqueue('merchant_widget');
    await waitFor(async () => (await posted()).length === 1, 'first job running');
    // The younger shopify waiter parks first; the older merchant waiter must still win.
    const shopify = await enqueue('shopify', { ageMin: 1 });
    await waitFor(() => parkedCount() === 1, 'shopify parked');
    const merchant = await enqueue('merchant_widget', { ageMin: 10 });
    await waitFor(() => parkedCount() === 2, 'both parked');
    finishLast();
    await waitFor(async () => (await posted()).length === 2, 'second started');
    expect((await posted())[1]).toBe(merchant.job.id);
    finishLast();
    await waitFor(async () => (await posted()).length === 3, 'third started');
    expect((await posted())[2]).toBe(shopify.job.id);
  }, 60_000);

  it('no-preprocessing-spam: a waiting job writes one waiting event and stays QUEUED', async () => {
    await setWorkers([{ id: 'cat', pools: ['catalogue'] }]);
    const sse = new Redis(env.redisUrl);
    const seen: Array<{ jobId: string; status: string }> = [];
    sse.on('message', (_c, raw) => seen.push(JSON.parse(raw)));
    await sse.subscribe('sse:events:admin');
    startLane(2);
    await enqueue('regular');
    await waitFor(async () => (await posted()).length === 1, 'first job running');
    const waiter = await enqueue('regular');
    await waitFor(() => parkedCount() === 1, 'parked');
    // Several scheduler ticks and failed wake attempts pass while it waits.
    await new Promise((r) => setTimeout(r, 4_500));
    expect((await jobRow(waiter.job.id))?.status).toBe('QUEUED');
    expect(await eventCount(waiter.job.id, 'WAITING_FOR_WORKER')).toBe(1);
    expect(await eventCount(waiter.job.id, 'PREPROCESSING')).toBe(0);
    expect(seen.filter((m) => m.jobId === waiter.job.id)).toEqual([]);

    finishLast();
    await waitFor(async () => (await posted()).length === 2, 'waiter started');
    expect(await eventCount(waiter.job.id, 'PREPROCESSING')).toBe(1);
    await waitFor(
      () => seen.some((m) => m.jobId === waiter.job.id && m.status === 'PREPROCESSING'),
      'SSE',
    );
    // PREPROCESSING went out once; later statuses (GENERATING) are the job's own progress.
    expect(
      seen.filter((m) => m.jobId === waiter.job.id && m.status === 'PREPROCESSING'),
    ).toHaveLength(1);
    sse.disconnect();
  }, 60_000);

  it('waiting-then-cancelled: a cancel during the wait ends the job CANCELLED with one refund, no POST', async () => {
    await setWorkers([{ id: 'cat', pools: ['catalogue'] }]);
    startLane(2);
    await enqueue('regular');
    await waitFor(async () => (await posted()).length === 1, 'first job running');
    const waiter = await enqueue('regular');
    await waitFor(() => parkedCount() === 1, 'parked');
    // What POST /jobs/:id/cancel does: status and refund in one transaction.
    await env.db.transaction(async (tx) => {
      await tx
        .update(schema.jobs)
        .set({ status: 'CANCELLED' })
        .where(eq(schema.jobs.id, waiter.job.id));
      await tx
        .update(schema.userCredits)
        .set({ balance: 5 })
        .where(eq(schema.userCredits.userId, waiter.user.id));
    });
    await waitFor(() => parkedCount() === 0, 'cancelled waiter resumed and dropped');
    // Only the running job's message is still pending: the cancelled one was ACKed.
    await waitFor(
      async () => ((await redis.xpending('jobs:normal', 'dispatcher-cg')) as [number])[0] === 1,
      'acked',
    );
    expect(await posted()).toHaveLength(1);
    expect((await jobRow(waiter.job.id))?.status).toBe('CANCELLED');
    const [credits] = await env.db
      .select()
      .from(schema.userCredits)
      .where(eq(schema.userCredits.userId, waiter.user.id));
    expect(credits?.balance).toBe(5);
    const control = await env.db.execute(
      sql`select owner_retired from dispatcher_job_control where job_id = ${waiter.job.id}`,
    );
    expect(control[0]).toMatchObject({ owner_retired: true });
  }, 60_000);

  it('cancel-between-acquire-and-reserve: a job cancelled after admission releases its worker and ACKs, no upload, no POST', async () => {
    const [workerId] = await setWorkers([{ id: 'cat', pools: ['catalogue'] }]);
    const { user, job } = await seedPaidJob(env, 'regular');
    const messageId = (await redis.xadd(
      'jobs:normal',
      '*',
      'jobId',
      job.id,
      'userId',
      user.id,
    )) as string;
    await redis.xreadgroup(
      'GROUP',
      'dispatcher-cg',
      hostname(),
      'COUNT',
      1,
      'STREAMS',
      'jobs:normal',
      '>',
    );
    const original = selector.selectWorker;
    const spy = vi.spyOn(selector, 'selectWorker').mockImplementation(async (...args) => {
      // The cancel lands after the job was admitted and before it reserves a worker.
      await env.db.transaction(async (tx) => {
        await tx.update(schema.jobs).set({ status: 'CANCELLED' }).where(eq(schema.jobs.id, job.id));
        await tx
          .update(schema.userCredits)
          .set({ balance: 5 })
          .where(eq(schema.userCredits.userId, user.id));
      });
      return original(...args);
    });
    try {
      await processJob(cfg(), job.id, user.id, 'jobs:normal', messageId);
    } finally {
      spy.mockRestore();
    }
    expect((await jobRow(job.id))?.status).toBe('CANCELLED');
    expect(comfy.accepted()).toHaveLength(0);
    expect(comfy.uploadedFilenames().slice(uploadsAtStart)).toEqual([]);
    expect(await redis.hget(RESERVATIONS_KEY, workerId as string)).toBeNull();
    expect(((await redis.xpending('jobs:normal', 'dispatcher-cg')) as [number])[0]).toBe(0);
    const [credits] = await env.db
      .select()
      .from(schema.userCredits)
      .where(eq(schema.userCredits.userId, user.id));
    expect(credits?.balance).toBe(5);
  }, 60_000);

  it('parked-message-not-reclaimed: recovery never takes a parked job’s message, however small the idle threshold', async () => {
    await setWorkers([{ id: 'cat', pools: ['catalogue'] }]);
    startLane(2);
    await enqueue('regular');
    await waitFor(async () => (await posted()).length === 1, 'first job running');
    const waiter = await enqueue('regular');
    await waitFor(() => parkedCount() === 1, 'parked');
    const entry = async () => {
      const rows = (await redis.xpending('jobs:normal', 'dispatcher-cg', '-', '+', 10)) as Array<
        [string, string, number, number]
      >;
      const messages = await redis.xrange('jobs:normal', '-', '+');
      const id = messages.find(([, f]) => f.includes(waiter.job.id))?.[0];
      return rows.find(([mid]) => mid === id);
    };
    const before = await entry();
    expect(before?.[1]).toBe(hostname());
    // Threshold zero: every pending entry is old enough to claim. The live lease must stop it.
    for (let i = 0; i < 3; i++) {
      await recoverPendingJobs(redis, cfg(), 0, log, ['jobs:normal'], { background: true });
      await new Promise((r) => setTimeout(r, 150));
    }
    const after = await entry();
    expect(after?.[1]).toBe(before?.[1]);
    expect(after?.[3]).toBe(before?.[3]);
    expect(parkedJobIds()).toContain(waiter.job.id);
  }, 60_000);

  it('parked-message-not-reclaimed-odd-field: a field VALUE reading "jobId" never stands in for the job id', async () => {
    await setWorkers([{ id: 'cat', pools: ['catalogue'] }]);
    startLane(2);
    await enqueue('regular');
    await waitFor(async () => (await posted()).length === 1, 'first job running');
    // The entry reads [note, jobId, jobId, <id>]: indexOf('jobId') lands on the value of `note`.
    const waiter = await enqueue('regular', { leading: ['note', 'jobId'] });
    await waitFor(() => parkedCount() === 1, 'parked');
    const entry = async () => {
      const rows = (await redis.xpending('jobs:normal', 'dispatcher-cg', '-', '+', 10)) as Array<
        [string, string, number, number]
      >;
      const messages = await redis.xrange('jobs:normal', '-', '+');
      const id = messages.find(([, f]) => f.includes(waiter.job.id))?.[0];
      return rows.find(([mid]) => mid === id);
    };
    const before = await entry();
    expect(before?.[1]).toBe(hostname());
    // Threshold zero: every pending entry is old enough to claim. The live lease must stop it.
    for (let i = 0; i < 3; i++) {
      await recoverPendingJobs(redis, cfg(), 0, log, ['jobs:normal'], { background: true });
      await new Promise((r) => setTimeout(r, 150));
    }
    const after = await entry();
    expect(after?.[1]).toBe(before?.[1]);
    expect(after?.[3]).toBe(before?.[3]);
    expect(parkedJobIds()).toContain(waiter.job.id);
  }, 60_000);

  it('head-failure-does-not-stall-pool: a head that loses ownership on resume lets the next waiter run', async () => {
    await setWorkers([{ id: 'cat', pools: ['catalogue'] }]);
    startLane(3);
    await enqueue('regular');
    await waitFor(async () => (await posted()).length === 1, 'first job running');
    const head = await enqueue('regular', { ageMin: 10 });
    const next = await enqueue('regular', { ageMin: 5 });
    const last = await enqueue('regular', { ageMin: 1 });
    await waitFor(() => parkedCount() === 3, 'three parked');
    // Another owner takes the head's job: its resume finds the lease lost and stops.
    await env.db.execute(
      sql`update dispatcher_job_control set owner_session = ${randomUUID()}, generation = generation + 1 where job_id = ${head.job.id}`,
    );
    finishLast();
    await waitFor(async () => (await posted()).length === 2, 'next waiter started');
    const order = await posted();
    expect(order[1]).toBe(next.job.id);
    expect(order).not.toContain(head.job.id);
    finishLast();
    await waitFor(async () => (await posted()).length === 3, 'last waiter started');
    expect((await posted())[2]).toBe(last.job.id);
    expect(await jobRow(head.job.id)).toMatchObject({ status: 'QUEUED', attempts: 0 });
    // The set of jobs this test touched, for the failure message if a later assertion is added.
    void inArray;
  }, 90_000);
});
