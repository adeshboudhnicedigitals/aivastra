import { type ChildProcess, fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { createLogger } from '@aivastra/logger';
import { eq, sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ADMISSION_KEY,
  REGISTRY_KEY,
  RESERVATIONS_KEY,
  releaseWorker,
  reservationToken,
  transientReservationToken,
} from '../../src/worker/registry.js';
import {
  claimDispatcherSession,
  rebuildWorkerRegistry,
  reconcileWorkerReservations,
  startReservationReconciler,
} from '../../src/worker/reservation-reconciler.js';
import { selectWorker } from '../../src/worker/selector.js';
import { setupTestEnv, type TestEnv } from '../helpers/containers.js';
import { seedPaidJob } from '../helpers/paid-jobs.js';

// Registry rebuild at startup, token-checked releases and admin reactivation. The restart is a
// real process (reservation-boot-child.ts) against the same Postgres and Redis.
describe('worker reservation: rebuild, tokens and reactivation', () => {
  let env: TestEnv;
  let redis: Redis;
  const log = createLogger('reservation-rebuild-test');
  const workerId = `rb-${randomUUID()}`;
  const prefix = `${workerId}:`;
  const children = new Set<ChildProcess>();
  const URL_ = 'http://127.0.0.1:1';

  const cfg = () => ({ db: env.db, redis, log, uncertainCheckMs: 90_000 });

  function boot(): Promise<{ holds: Record<string, string> }> {
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
          // No worker is listening on URL_, so the boot pass must not depend on one.
          RES_TEST_RECONCILE: '0',
        },
      });
      children.add(child);
      let message: { holds: Record<string, string> } | null = null;
      child.on('message', (m) => {
        message = m as { holds: Record<string, string> };
      });
      child.on('exit', (code) =>
        code === 0 && message ? resolve(message) : reject(new Error(`boot child exit ${code}`)),
      );
    });
  }

  const status = async () =>
    (JSON.parse((await redis.hget(REGISTRY_KEY, workerId)) ?? '{}') as { status?: string }).status;
  const claim = (token: string) =>
    selectWorker(redis, 'tryon', undefined, { jobId: 'probe', log, token });

  /** The unresolved ACCEPTED attempt a crashed owner leaves behind on the worker. */
  async function leaveUnresolvedAttempt() {
    const seeded = await seedPaidJob(env, 'regular');
    const session = randomUUID();
    await env.db.insert(schema.dispatcherJobControl).values({
      jobId: seeded.job.id,
      ownerSession: session,
      generation: 3n,
      leaseUntil: sql`clock_timestamp() - interval '1 second'`,
    });
    const [attempt] = await env.db
      .insert(schema.executionAttempts)
      .values({
        jobId: seeded.job.id,
        attemptNo: 1,
        phase: 'main',
        clientId: `av:${seeded.job.id}:1:main`,
        state: 'ACCEPTED',
        workerId,
        workerUrl: URL_,
        promptId: 'p-1',
        contract: { version: 1 },
      })
      .returning();
    if (!attempt) throw new Error('attempt missing');
    return {
      seeded,
      session,
      attempt,
      token: reservationToken({ session, generation: 3, attemptId: attempt.id }),
    };
  }

  beforeAll(async () => {
    env = await setupTestEnv();
    redis = new Redis(env.redisUrl, { keyPrefix: prefix });
  }, 60_000);
  beforeEach(async () => {
    await env.db
      .update(schema.executionAttempts)
      .set({ resolvedAt: sql`now()` })
      .where(sql`${schema.executionAttempts.resolvedAt} is null`);
    await env.db.delete(schema.workers);
    await env.db
      .insert(schema.workers)
      .values({ id: workerId, url: URL_, apiKey: 'fixture', isActive: true });
    await redis.setex(`worker:health:${workerId}`, 600, '1');
    await rebuildWorkerRegistry({
      db: env.db,
      redis,
      log,
      workers: await env.db.select().from(schema.workers),
    });
  });
  afterEach(() => {
    for (const child of children) child.kill('SIGKILL');
    children.clear();
  });
  afterAll(async () => {
    redis.disconnect();
    await env?.cleanup();
  });

  it('rebuild-before-idle: admission stays closed until the holds are rebuilt, then the held worker is BUSY', async () => {
    const left = await leaveUnresolvedAttempt();
    await redis.del(ADMISSION_KEY);
    // Registry says IDLE but nothing is claimable while the registry is not rebuilt.
    await redis.hset(
      REGISTRY_KEY,
      workerId,
      JSON.stringify({ url: URL_, apiKey: 'k', status: 'IDLE', lastSeen: 0, allowedJobTypes: [] }),
    );
    expect(await claim('t-closed')).toBeNull();

    const { holds } = await boot();

    expect(holds[workerId]).toBe(left.token);
    expect(await status()).toBe('BUSY');
    expect(await claim('t-after')).toBeNull();
  });

  it('late-release-token: a release carrying an old or foreign token frees nothing', async () => {
    const left = await leaveUnresolvedAttempt();
    await boot();
    expect(await redis.hget(RESERVATIONS_KEY, workerId)).toBe(left.token);

    // A dead owner's late release, and another owner's, must not free the rebuilt hold.
    const stale = reservationToken({
      session: randomUUID(),
      generation: 1,
      attemptId: randomUUID(),
    });
    expect(await releaseWorker(redis, workerId, stale, log)).toBe(false);
    expect(await releaseWorker(redis, workerId, transientReservationToken(), log)).toBe(false);
    expect(await redis.hget(RESERVATIONS_KEY, workerId)).toBe(left.token);
    expect(await status()).toBe('BUSY');

    expect(await releaseWorker(redis, workerId, left.token, log)).toBe(true);
    expect(await status()).toBe('IDLE');
  });

  it('admin-reactivate-reserved-worker: an admin edit to IDLE does not make a reserved worker claimable', async () => {
    const left = await leaveUnresolvedAttempt();
    await env.db
      .update(schema.workers)
      .set({ isActive: false })
      .where(eq(schema.workers.id, workerId));
    await boot();
    // Kept for observation but closed to admission.
    expect(await status()).toBe('DRAINING');
    expect(await redis.hget(RESERVATIONS_KEY, workerId)).toBe(left.token);

    // The admin PATCH with isActive:true writes DRAINING -> IDLE on the registry entry
    // (workers.routes.ts); it knows nothing about the token.
    const entry = JSON.parse((await redis.hget(REGISTRY_KEY, workerId)) ?? '{}');
    entry.status = 'IDLE';
    await redis.hset(REGISTRY_KEY, workerId, JSON.stringify(entry));

    expect(await claim('t-admin')).toBeNull();
    expect(await redis.hget(RESERVATIONS_KEY, workerId)).toBe(left.token);
  });

  it('inactive worker survives a restart as DRAINING and reactivates with only isActive: true', async () => {
    await env.db
      .update(schema.workers)
      .set({ isActive: false })
      .where(eq(schema.workers.id, workerId));

    await boot();

    // Before C the startup deleted this entry, and a bare activity toggle then left the worker
    // absent forever.
    expect(await redis.hexists(REGISTRY_KEY, workerId)).toBe(1);
    expect(await status()).toBe('DRAINING');
    expect(await claim('t-inactive')).toBeNull();

    const entry = JSON.parse((await redis.hget(REGISTRY_KEY, workerId)) ?? '{}');
    if (entry.status === 'DRAINING') entry.status = 'IDLE';
    await redis.hset(REGISTRY_KEY, workerId, JSON.stringify(entry));
    expect((await claim('t-reactivated'))?.id).toBe(workerId);
  });

  it('a hold with no unresolved attempt behind it (provisional claim, classify) is dropped on rebuild', async () => {
    await redis.hset(RESERVATIONS_KEY, workerId, transientReservationToken());
    await redis.hset(
      REGISTRY_KEY,
      workerId,
      JSON.stringify({ url: URL_, apiKey: 'k', status: 'BUSY', lastSeen: 0, allowedJobTypes: [] }),
    );

    const { holds } = await boot();

    expect(holds[workerId]).toBeUndefined();
    expect(await status()).toBe('IDLE');
  });

  it('a Redis reset closes admission and the reconciler tick rebuilds the registry', async () => {
    const left = await leaveUnresolvedAttempt();
    await redis.del(ADMISSION_KEY, REGISTRY_KEY, RESERVATIONS_KEY);
    expect(await claim('t-reset')).toBeNull();

    const stop = startReservationReconciler(cfg(), async () => {
      await rebuildWorkerRegistry({
        db: env.db,
        redis,
        log,
        workers: await env.db.select().from(schema.workers),
      });
    });
    try {
      for (let i = 0; i < 200 && (await redis.exists(ADMISSION_KEY)) === 0; i++)
        await new Promise((r) => setTimeout(r, 25));
    } finally {
      stop();
    }
    expect(await redis.hget(RESERVATIONS_KEY, workerId)).toBe(left.token);
    expect(await status()).toBe('BUSY');
  });

  it('a second live dispatcher is refused, a lapsed marker is taken over', async () => {
    const first = randomUUID();
    await claimDispatcherSession(redis, first, log, 0);
    await expect(claimDispatcherSession(redis, randomUUID(), log, 0)).rejects.toThrow(
      /another dispatcher session is live/,
    );
    await redis.del('dispatcher:active-session');
    await expect(claimDispatcherSession(redis, randomUUID(), log, 0)).resolves.toBeUndefined();
  });

  it('a reconcile pass with no holds does nothing', async () => {
    await reconcileWorkerReservations(cfg());
    expect(await status()).toBe('IDLE');
  });
});
