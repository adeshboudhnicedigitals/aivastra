import { type ChildProcess, fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { createLogger } from '@aivastra/logger';
import { eq, sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { processJob } from '../../src/job/processor.js';
import { RESERVATIONS_KEY } from '../../src/worker/registry.js';
import { rebuildWorkerRegistry } from '../../src/worker/reservation-reconciler.js';
import { type ComfyMock, startComfyMock } from './comfy-mock.js';
import { setupTestEnv, type TestEnv } from './containers.js';
import { seedPaidJob } from './paid-jobs.js';

/**
 * A real owner process (reservation-child.ts) that is SIGKILLed against a fake worker that
 * outlives it, then a replacement `processJob` in this process under a new session. Shared by
 * the adoption and uncertain-submission suites.
 */
export async function adoptionFixture(label: string) {
  const env: TestEnv = await setupTestEnv();
  const workerId = `${label}-${randomUUID()}`;
  const prefix = `${workerId}:`;
  const redis = new Redis(env.redisUrl, { keyPrefix: prefix });
  const comfy: ComfyMock = await startComfyMock();
  const log = createLogger(`${label}-test`);
  const children = new Set<ChildProcess>();
  await env.db
    .insert(schema.workers)
    .values({ id: workerId, url: comfy.url, apiKey: 'fixture', isActive: true });

  async function reset() {
    comfy.resetPrompts();
    comfy.setOptions({});
    await env.db
      .update(schema.executionAttempts)
      .set({ resolvedAt: sql`now()` })
      .where(sql`${schema.executionAttempts.resolvedAt} is null`);
    await redis.hdel(RESERVATIONS_KEY, workerId);
    await rebuildWorkerRegistry({
      db: env.db,
      redis,
      log,
      workers: await env.db.select().from(schema.workers),
    });
    await redis.setex(`worker:health:${workerId}`, 600, '1');
  }

  const childEnv = (extra: Record<string, string>) => ({
    PATH: process.env.PATH,
    NODE_ENV: 'test',
    RES_TEST_DATABASE_URL: env.databaseUrl,
    RES_TEST_REDIS_URL: env.redisUrl,
    RES_TEST_REDIS_PREFIX: prefix,
    ...extra,
  });

  /** An owner that reserved the worker and POSTed; killed once the worker holds the prompt. */
  async function crashedOwner(opts: {
    withReceipt: boolean;
    leaveRunning?: boolean;
    child?: string;
    env?: Record<string, string>;
  }) {
    const seeded = await seedPaidJob(env, 'regular');
    const session = randomUUID();
    const child = fork(new URL(opts.child ?? './reservation-child.ts', import.meta.url), [], {
      execArgv: ['--import', 'tsx'],
      silent: true,
      env: childEnv({ RES_TEST_JOB_ID: seeded.job.id, RES_TEST_SESSION: session, ...opts.env }),
    });
    children.add(child);
    const exited = new Promise<void>((resolve) => child.on('exit', () => resolve()));
    const reserved = new Promise<{ attemptId: string; clientId: string; token: string }>(
      (resolve, reject) => {
        child.on('message', (m) => {
          const msg = m as { reserved?: { attemptId: string; clientId: string; token: string } };
          if (msg.reserved) resolve(msg.reserved);
        });
        child.on('exit', () => reject(new Error('owner exited before reserving')));
      },
    );
    const receipt = new Promise<void>((resolve) =>
      child.on('message', (m) => {
        if ((m as { receipt?: boolean }).receipt) resolve();
      }),
    );
    const { attemptId, clientId } = await reserved;
    if (opts.withReceipt) await receipt;
    else
      for (let i = 0; i < 400 && comfy.accepted().length < 1; i++)
        await new Promise((r) => setTimeout(r, 25));
    const accepted = comfy.accepted().at(-1);
    if (!accepted) throw new Error('worker saw no POST');
    if (!opts.leaveRunning) {
      child.kill('SIGKILL');
      await exited;
    }
    return { exited, seeded, session, attemptId, clientId, promptId: accepted.promptId, child };
  }

  const expireLease = (jobId: string) =>
    env.db
      .update(schema.dispatcherJobControl)
      .set({ leaseUntil: sql`clock_timestamp() - interval '1 second'` })
      .where(eq(schema.dispatcherJobControl.jobId, jobId));

  const processorCfg = (extra: Record<string, unknown> = {}) => ({
    db: env.db,
    redis,
    comfyRedis: redis,
    pub: redis,
    storage: env.storage,
    log,
    ownerSession: randomUUID(),
    uncertainCheckMs: 90_000,
    adoptionSearchPollMs: 100,
    comfyPollIntervalMs: 100,
    ...extra,
  });

  /** The replacement dispatcher's delivery of the dead owner's PEL entry. */
  const replacement = (jobId: string, userId: string, extra: Record<string, unknown> = {}) =>
    processJob(processorCfg(extra), jobId, userId, 'jobs:normal', '0-1');

  const jobRow = async (id: string) => {
    const [row] = await env.db.select().from(schema.jobs).where(eq(schema.jobs.id, id));
    if (!row) throw new Error('job missing');
    return row;
  };
  const attemptRow = async (id: string) => {
    const [row] = await env.db
      .select()
      .from(schema.executionAttempts)
      .where(eq(schema.executionAttempts.id, id));
    if (!row) throw new Error('attempt missing');
    return row;
  };
  const outputs = (jobId: string) =>
    env.db.select().from(schema.jobOutputs).where(eq(schema.jobOutputs.jobId, jobId));
  const balance = async (userId: string) =>
    (await env.db.select().from(schema.userCredits).where(eq(schema.userCredits.userId, userId)))[0]
      ?.balance;
  const events = (jobId: string, type: string) =>
    env.db
      .select()
      .from(schema.jobEvents)
      .where(sql`${schema.jobEvents.jobId} = ${jobId} and ${schema.jobEvents.eventType} = ${type}`);

  async function close() {
    for (const child of children) child.kill('SIGKILL');
    await comfy.close();
    redis.disconnect();
    await env.cleanup();
  }

  return {
    env,
    redis,
    comfy,
    workerId,
    reset,
    crashedOwner,
    expireLease,
    replacement,
    processorCfg,
    log,
    childEnv,
    jobRow,
    attemptRow,
    outputs,
    balance,
    events,
    close,
    held: () => redis.hget(RESERVATIONS_KEY, workerId),
  };
}
