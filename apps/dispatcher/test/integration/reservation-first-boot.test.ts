import { type ChildProcess, fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { createLogger } from '@aivastra/logger';
import { eq, sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { REGISTRY_KEY, RESERVATIONS_KEY } from '../../src/worker/registry.js';
import {
  reconcileWorkerReservations,
  resetReservationClocks,
} from '../../src/worker/reservation-reconciler.js';
import { selectWorker } from '../../src/worker/selector.js';
import { type ComfyMock, startComfyMock } from '../helpers/comfy-mock.js';
import { setupTestEnv, type TestEnv } from '../helpers/containers.js';
import { seedPaidJob } from '../helpers/paid-jobs.js';

type BootReport = { holds: Record<string, string>; admissionOpenMs: number; bootMs: number };

// The first start of Phase C against production's shape: finished jobs whose FAILED attempts
// never recorded a finish time (failures leave resolved_at null on purpose). The fake worker
// has an empty queue and history, as after a ComfyUI restart.
describe('worker reservation: first boot with historical attempts', () => {
  let env: TestEnv;
  let redis: Redis;
  let live: ComfyMock;
  let busy: ComfyMock;
  const log = createLogger('reservation-first-boot-test');
  const run = randomUUID();
  const prefix = `${run}:`;
  const children = new Set<ChildProcess>();
  const DEAD_URL = 'http://127.0.0.1:1';
  const ids = { a: `fb-a-${run}`, b: `fb-b-${run}`, c: `fb-c-${run}`, down: `fb-down-${run}` };

  function boot(): Promise<BootReport> {
    return new Promise((resolve, reject) => {
      const child = fork(new URL('../helpers/reservation-boot-child.ts', import.meta.url), [], {
        execArgv: ['--import', 'tsx'],
        silent: true,
        env: {
          PATH: process.env.PATH,
          NODE_ENV: 'test',
          RES_TEST_DATABASE_URL: env.databaseUrl,
          RES_TEST_REDIS_URL: env.redisUrl,
          RES_TEST_REDIS_PREFIX: prefix,
          RES_TEST_UNCERTAIN_MS: '90000',
        },
      });
      children.add(child);
      let report: BootReport | null = null;
      child.on('message', (m) => {
        report = m as BootReport;
      });
      child.on('exit', (code) =>
        code === 0 && report ? resolve(report) : reject(new Error(`boot child exit ${code}`)),
      );
    });
  }

  /** A FAILED, unresolved attempt on a finished job, as production holds 21 of. */
  async function historicalAttempt(
    workerId: string,
    url: string,
    promptId = `old-${randomUUID()}`,
  ) {
    const seeded = await seedPaidJob(env, 'regular');
    await env.db
      .update(schema.jobs)
      .set({ status: 'FAILED' })
      .where(eq(schema.jobs.id, seeded.job.id));
    const [attempt] = await env.db
      .insert(schema.executionAttempts)
      .values({
        jobId: seeded.job.id,
        attemptNo: 1,
        phase: 'main',
        clientId: `av:${seeded.job.id}:1:main`,
        state: 'FAILED',
        workerId,
        workerUrl: url,
        promptId,
        contract: { version: 1 },
      })
      .returning();
    if (!attempt) throw new Error('attempt missing');
    return { attempt, jobId: seeded.job.id, promptId };
  }

  const claim = (token: string) =>
    selectWorker(redis, 'tryon', undefined, { jobId: 'probe', log, token });
  const attemptRow = async (id: string) => {
    const [row] = await env.db
      .select()
      .from(schema.executionAttempts)
      .where(eq(schema.executionAttempts.id, id));
    if (!row) throw new Error('missing');
    return row;
  };
  const status = async (id: string) =>
    (JSON.parse((await redis.hget(REGISTRY_KEY, id)) ?? '{}') as { status?: string }).status;

  beforeAll(async () => {
    env = await setupTestEnv();
    redis = new Redis(env.redisUrl, { keyPrefix: prefix });
    live = await startComfyMock();
    busy = await startComfyMock();
  }, 60_000);
  beforeEach(async () => {
    live.resetPrompts();
    busy.resetPrompts();
    resetReservationClocks();
    await env.db
      .update(schema.executionAttempts)
      .set({ resolvedAt: sql`now()` })
      .where(sql`${schema.executionAttempts.resolvedAt} is null`);
    await env.db.delete(schema.workers);
    await redis.del(REGISTRY_KEY, RESERVATIONS_KEY);
    for (const [id, url] of [
      [ids.a, live.url],
      [ids.b, live.url],
      [ids.c, busy.url],
      [ids.down, DEAD_URL],
    ] as const) {
      await env.db.insert(schema.workers).values({ id, url, apiKey: 'fixture', isActive: true });
      await redis.setex(`worker:health:${id}`, 600, '1');
    }
  });
  afterEach(() => {
    for (const child of children) child.kill('SIGKILL');
    children.clear();
  });
  afterAll(async () => {
    await live.close();
    await busy.close();
    redis.disconnect();
    await env?.cleanup();
  });

  it('first-boot-with-historical-attempts: empty queue and history free every reachable worker at boot', async () => {
    const old = [
      await historicalAttempt(ids.a, live.url),
      await historicalAttempt(ids.a, live.url),
      await historicalAttempt(ids.b, live.url),
    ];

    const report = await boot();

    // One pass at boot, well inside the 10 s tick: nothing stays held.
    expect(report.holds).toEqual({});
    expect(report.admissionOpenMs).toBeLessThan(5_000);
    for (const o of old) {
      const row = await attemptRow(o.attempt.id);
      expect(row.resolvedAt).not.toBeNull();
      // Only the fact about the remote prompt is recorded; nothing else moves.
      expect(row.state).toBe('FAILED');
      const events = await env.db
        .select()
        .from(schema.jobEvents)
        .where(
          sql`${schema.jobEvents.jobId} = ${o.jobId} and ${schema.jobEvents.eventType} = 'COMFY_RESERVATION_RESOLVED'`,
        );
      expect(events).toHaveLength(1);
      expect(events[0]?.payload).toMatchObject({
        rule: 'known_prompt_absent',
        attemptId: o.attempt.id,
        workerId: row.workerId,
      });
    }
    expect(await status(ids.a)).toBe('IDLE');
    expect(await status(ids.b)).toBe('IDLE');
    expect((await claim('t-after-boot'))?.id).toMatch(/^fb-[ab]-/);
    console.info(
      `first boot: admission opened after ${report.admissionOpenMs.toFixed(0)} ms, whole boot ${report.bootMs.toFixed(0)} ms`,
    );
  });

  it('one unreachable worker stays held and the others open; it is freed once a complete check succeeds', async () => {
    const stuck = await historicalAttempt(ids.down, DEAD_URL);
    await historicalAttempt(ids.a, live.url);

    const report = await boot();

    expect(report.holds[ids.down]).toBeDefined();
    expect(report.holds[ids.a]).toBeUndefined();
    expect(await status(ids.down)).toBe('BUSY');
    expect(await status(ids.a)).toBe('IDLE');
    expect((await claim('t-others'))?.id).not.toBe(ids.down);
    expect((await attemptRow(stuck.attempt.id)).resolvedAt).toBeNull();

    // The worker comes back (same worker row, now answering) and the next pass frees it.
    await env.db
      .update(schema.workers)
      .set({ url: live.url })
      .where(eq(schema.workers.id, ids.down));
    await env.db
      .update(schema.executionAttempts)
      .set({ workerUrl: live.url })
      .where(eq(schema.executionAttempts.id, stuck.attempt.id));
    await redis.hset(
      REGISTRY_KEY,
      ids.down,
      JSON.stringify({
        url: live.url,
        apiKey: 'fixture',
        status: 'BUSY',
        lastSeen: 0,
        allowedJobTypes: [],
      }),
    );
    await reconcileWorkerReservations({ db: env.db, redis, log, uncertainCheckMs: 90_000 });

    expect(await redis.hget(RESERVATIONS_KEY, ids.down)).toBeNull();
    expect((await attemptRow(stuck.attempt.id)).resolvedAt).not.toBeNull();
    expect(await status(ids.down)).toBe('IDLE');
  });

  it('a worker whose queue still has the prompt stays held until it ends', async () => {
    busy.setOptions({ completionDelayMs: 600_000 });
    const posted = await fetch(`${busy.url}/prompt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: {}, client_id: 'someone' }),
    });
    const { prompt_id: runningId } = (await posted.json()) as { prompt_id: string };
    const held = await historicalAttempt(ids.c, busy.url, runningId);

    const report = await boot();

    expect(report.holds[ids.c]).toBeDefined();
    expect(await status(ids.c)).toBe('BUSY');
    expect((await attemptRow(held.attempt.id)).resolvedAt).toBeNull();

    busy.finishPrompt(runningId);
    await reconcileWorkerReservations({ db: env.db, redis, log, uncertainCheckMs: 90_000 });
    expect(await redis.hget(RESERVATIONS_KEY, ids.c)).toBeNull();
    expect((await attemptRow(held.attempt.id)).resolvedAt).not.toBeNull();
  });
});
