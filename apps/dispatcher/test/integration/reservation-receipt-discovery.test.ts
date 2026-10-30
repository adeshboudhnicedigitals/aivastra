import { type ChildProcess, fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { createLogger } from '@aivastra/logger';
import {
  dispatcherReservationFinishedHoldSeconds,
  dispatcherReservationReconcileStaleSeconds,
  dispatcherReservationUnknownHoldSeconds,
} from '@aivastra/observability';
import { eq, sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { REGISTRY_KEY, RESERVATIONS_KEY } from '../../src/worker/registry.js';
import {
  rebuildWorkerRegistry,
  reconcileWorkerReservations,
  resetReservationClocks,
} from '../../src/worker/reservation-reconciler.js';
import { type ComfyMock, startComfyMock } from '../helpers/comfy-mock.js';
import { setupTestEnv, type TestEnv } from '../helpers/containers.js';
import { seedPaidJob } from '../helpers/paid-jobs.js';

// Lost-receipt discovery: a real owner process is SIGKILLed after the fake worker received
// /prompt and before the receipt was recorded. A second real process then performs the
// replacement dispatcher's startup. Nothing here may adopt, finalize, refund, spend the retry
// budget, create an attempt or POST: the fake worker's POST counter and the job/ledger rows
// are asserted unchanged after every outcome.
describe('worker reservation: lost-receipt discovery', () => {
  let env: TestEnv;
  let redis: Redis;
  let comfy: ComfyMock;
  const log = createLogger('reservation-discovery-test');
  const workerId = `res-${randomUUID()}`;
  const prefix = `${workerId}:`;
  const children = new Set<ChildProcess>();
  let clock = Date.now();
  const UNCERTAIN_MS = 90_000;

  const cfg = () => ({
    db: env.db,
    redis,
    log,
    uncertainCheckMs: UNCERTAIN_MS,
    now: () => clock,
  });

  const childEnv = (extra: Record<string, string>) => ({
    PATH: process.env.PATH,
    NODE_ENV: 'test',
    RES_TEST_DATABASE_URL: env.databaseUrl,
    RES_TEST_REDIS_URL: env.redisUrl,
    RES_TEST_REDIS_PREFIX: prefix,
    RES_TEST_UNCERTAIN_MS: String(UNCERTAIN_MS),
    ...extra,
  });

  async function rebuild() {
    await rebuildWorkerRegistry({
      db: env.db,
      redis,
      log,
      workers: await env.db.select().from(schema.workers),
    });
    await redis.setex(`worker:health:${workerId}`, 600, '1');
  }

  /** The replacement dispatcher's startup, as a real process. */
  function boot(extra: Record<string, string> = {}): Promise<{ holds: Record<string, string> }> {
    return new Promise((resolve, reject) => {
      const child = fork(new URL('../helpers/reservation-boot-child.ts', import.meta.url), [], {
        execArgv: ['--import', 'tsx'],
        silent: true,
        env: childEnv(extra),
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

  /** An owner process that reserved the worker and is blocked at the one POST. */
  async function startOwner(extra: Record<string, string> = {}) {
    const seeded = await seedPaidJob(env, 'regular');
    const session = randomUUID();
    const child = fork(new URL('../helpers/reservation-child.ts', import.meta.url), [], {
      execArgv: ['--import', 'tsx'],
      silent: true,
      env: childEnv({ RES_TEST_JOB_ID: seeded.job.id, RES_TEST_SESSION: session, ...extra }),
    });
    children.add(child);
    const exited = new Promise<void>((resolve) => child.on('exit', () => resolve()));
    const reserved = await new Promise<{ attemptId: string; clientId: string; token: string }>(
      (resolve, reject) => {
        child.on('message', (m) => {
          const msg = m as { reserved?: { attemptId: string; clientId: string; token: string } };
          if (msg.reserved) resolve(msg.reserved);
        });
        child.on('exit', () => reject(new Error('owner exited before reserving')));
      },
    );
    return { seeded, session, child, exited, ...reserved };
  }

  async function waitForAccept(count = 1) {
    // The fake counts a POST the moment it reads it; the child is then parked on the reply.
    for (let i = 0; i < 400 && comfy.accepted().length < count; i++)
      await new Promise((r) => setTimeout(r, 25));
    expect(comfy.accepted().length).toBeGreaterThanOrEqual(count);
  }

  /** SIGKILL the owner once the fake worker holds the prompt but no receipt was recorded. */
  async function loseReceipt(extra: Record<string, string> = {}) {
    comfy.setOptions({ holdPromptResponse: true, completionDelayMs: 600_000 });
    const owner = await startOwner(extra);
    await waitForAccept();
    owner.child.kill('SIGKILL');
    await owner.exited;
    const accepted = comfy.accepted().at(-1);
    if (!accepted) throw new Error('worker saw no POST');
    return { ...owner, promptId: accepted.promptId };
  }

  /** The dead owner's lease lapses (test gate: the 30 s expiry is moved, never waited out). */
  const expireLease = (jobId: string) =>
    env.db
      .update(schema.dispatcherJobControl)
      .set({ leaseUntil: sql`clock_timestamp() - interval '1 second'` })
      .where(eq(schema.dispatcherJobControl.jobId, jobId));

  const passDeadline = (attemptId: string) =>
    env.db
      .update(schema.executionAttempts)
      .set({ uncertainDeadline: sql`clock_timestamp() - interval '1 second'` })
      .where(eq(schema.executionAttempts.id, attemptId));

  const attemptRow = async (attemptId: string) => {
    const [row] = await env.db
      .select()
      .from(schema.executionAttempts)
      .where(eq(schema.executionAttempts.id, attemptId));
    if (!row) throw new Error('attempt missing');
    return row;
  };
  const jobRow = async (jobId: string) => {
    const [row] = await env.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    if (!row) throw new Error('job missing');
    return row;
  };
  const heldToken = () => redis.hget(RESERVATIONS_KEY, workerId);
  const workerStatus = async () =>
    (JSON.parse((await redis.hget(REGISTRY_KEY, workerId)) ?? '{}') as { status?: string }).status;
  const events = (jobId: string, type: string) =>
    env.db
      .select()
      .from(schema.jobEvents)
      .where(sql`${schema.jobEvents.jobId} = ${jobId} and ${schema.jobEvents.eventType} = ${type}`);
  const gauge = async (metric: {
    get: () => Promise<{ values: Array<{ value: number; labels: Record<string, unknown> }> }>;
  }) => (await metric.get()).values.find((v) => v.labels.worker_id === workerId)?.value ?? 0;

  /** Nothing the plan forbids C to do may have happened. */
  async function expectNoBusinessEffect(owner: {
    seeded: Awaited<ReturnType<typeof seedPaidJob>>;
    promptId: string;
    clientId: string;
  }) {
    const job = await jobRow(owner.seeded.job.id);
    expect(job.status).toBe('PREPROCESSING');
    expect(job.attempts).toBe(0);
    expect(
      await env.db.select().from(schema.creditLedger).where(eq(schema.creditLedger.jobId, job.id)),
    ).toEqual([]);
    expect(
      await env.db.select().from(schema.jobOutputs).where(eq(schema.jobOutputs.jobId, job.id)),
    ).toEqual([]);
    expect(
      await env.db
        .select()
        .from(schema.executionAttempts)
        .where(eq(schema.executionAttempts.jobId, job.id)),
    ).toHaveLength(1);
    // The one POST was the owner's; discovery added none.
    expect(comfy.postsFor(owner.clientId)).toBe(1);
  }

  beforeAll(async () => {
    env = await setupTestEnv();
    redis = new Redis(env.redisUrl, { keyPrefix: prefix });
    comfy = await startComfyMock();
    await env.db
      .insert(schema.workers)
      .values({ id: workerId, url: comfy.url, apiKey: 'fixture', isActive: true });
  }, 60_000);
  beforeEach(async () => {
    comfy.resetPrompts();
    comfy.setOptions({});
    clock = Date.now();
    resetReservationClocks();
    // Earlier cases leave unresolved attempts behind; a rebuild would hold them again.
    await env.db
      .update(schema.executionAttempts)
      .set({ resolvedAt: sql`now()` })
      .where(sql`${schema.executionAttempts.resolvedAt} is null`);
    await rebuild();
  });
  afterEach(() => {
    for (const child of children) child.kill('SIGKILL');
    children.clear();
  });
  afterAll(async () => {
    await comfy.close();
    redis.disconnect();
    await env?.cleanup();
  });

  it('lost-receipt-finished: a finished prompt is adopted as a diagnostic receipt and the worker freed', async () => {
    const owner = await loseReceipt();
    comfy.finishPrompt(owner.promptId);
    await expireLease(owner.seeded.job.id);

    await reconcileWorkerReservations(cfg());

    const attempt = await attemptRow(owner.attemptId);
    expect(attempt.promptId).toBe(owner.promptId);
    expect(attempt.state).toBe('SUBMITTING');
    expect(attempt.resolvedAt).not.toBeNull();
    expect(await events(owner.seeded.job.id, 'COMFY_RECEIPT_DISCOVERED')).toHaveLength(1);
    expect(await heldToken()).toBeNull();
    expect(await workerStatus()).toBe('IDLE');
    await expectNoBusinessEffect(owner);
  });

  it('lost-receipt-running: a queued or running prompt keeps the hold until it ends', async () => {
    const owner = await loseReceipt();
    await expireLease(owner.seeded.job.id);

    await reconcileWorkerReservations(cfg());
    expect(await heldToken()).toBe(owner.token);
    expect(await workerStatus()).toBe('BUSY');
    expect((await attemptRow(owner.attemptId)).promptId).toBe(owner.promptId);

    comfy.finishPrompt(owner.promptId);
    await reconcileWorkerReservations(cfg());
    expect(await heldToken()).toBeNull();
    expect(await workerStatus()).toBe('IDLE');
    // Found twice, recorded once.
    expect(await events(owner.seeded.job.id, 'COMFY_RECEIPT_DISCOVERED')).toHaveLength(1);
    await expectNoBusinessEffect(owner);
  });

  it('lost-receipt-never-accepted: only a clean check after the persisted deadline frees the worker', async () => {
    const owner = await loseReceipt();
    comfy.forgetPrompt(owner.promptId);
    await expireLease(owner.seeded.job.id);

    // Before the deadline a complete, clean absence still holds the worker.
    await reconcileWorkerReservations(cfg());
    expect(await heldToken()).toBe(owner.token);
    const first = (await attemptRow(owner.attemptId)).uncertainDeadline;
    expect(first).not.toBeNull();

    await passDeadline(owner.attemptId);
    await reconcileWorkerReservations(cfg());
    expect(await heldToken()).toBeNull();
    expect((await attemptRow(owner.attemptId)).promptId).toBeNull();
    await expectNoBusinessEffect(owner);
  });

  it('queue-to-history-discovery: a prompt that moves to history between the reads is still found', async () => {
    const owner = await loseReceipt();
    await expireLease(owner.seeded.job.id);
    // The prompt finishes while the queue read is in flight: the queue answer no longer lists it,
    // the history read made after it does.
    comfy.setOptions({
      onRequest: (method, path) => {
        if (method === 'GET' && path === '/queue') {
          comfy.setOptions({});
          comfy.finishPrompt(owner.promptId);
        }
      },
    });

    await reconcileWorkerReservations(cfg());

    expect((await attemptRow(owner.attemptId)).promptId).toBe(owner.promptId);
    expect(await heldToken()).toBeNull();
    await expectNoBusinessEffect(owner);
  });

  it('deadline-survives-restart: a real process restart keeps the first deadline and the hold', async () => {
    const owner = await loseReceipt();
    comfy.forgetPrompt(owner.promptId);
    await expireLease(owner.seeded.job.id);

    const first = await boot();
    const deadline = (await attemptRow(owner.attemptId)).uncertainDeadline;
    expect(deadline).not.toBeNull();
    expect(first.holds[workerId]).toBe(owner.token);

    const second = await boot();
    expect((await attemptRow(owner.attemptId)).uncertainDeadline?.getTime()).toBe(
      deadline?.getTime(),
    );
    expect(second.holds[workerId]).toBe(owner.token);
    await expectNoBusinessEffect(owner);
  });

  it('unreachable-held-alerted: a failing worker keeps the hold, even past the deadline, and the age is not reset', async () => {
    const owner = await loseReceipt();
    comfy.forgetPrompt(owner.promptId);
    await expireLease(owner.seeded.job.id);
    comfy.setOptions({ queueStatus: 500 });

    await reconcileWorkerReservations(cfg());
    await passDeadline(owner.attemptId);
    clock += 121_000;
    await reconcileWorkerReservations(cfg());
    clock += 5_000;
    await reconcileWorkerReservations(cfg());

    expect(await heldToken()).toBe(owner.token);
    expect(await gauge(dispatcherReservationReconcileStaleSeconds)).toBeGreaterThanOrEqual(120);
    expect(await gauge(dispatcherReservationUnknownHoldSeconds)).toBeGreaterThanOrEqual(120);

    // Verified resolution clears every age.
    comfy.setOptions({});
    await reconcileWorkerReservations(cfg());
    expect(await heldToken()).toBeNull();
    expect(await gauge(dispatcherReservationReconcileStaleSeconds)).toBe(0);
    expect(await gauge(dispatcherReservationUnknownHoldSeconds)).toBe(0);
    await expectNoBusinessEffect(owner);
  });

  it('cleanup-alert-120s: an unresolved unknown hold reports its age past 120s without being freed', async () => {
    const owner = await loseReceipt();
    await expireLease(owner.seeded.job.id);
    // The prompt is queued behind a long run, so no receipt can be classified as finished.
    await reconcileWorkerReservations(cfg());
    comfy.forgetPrompt(owner.promptId);
    comfy.setOptions({ queueBody: '{"queue_running": 5}' });
    clock += 125_000;
    await reconcileWorkerReservations(cfg());
    expect(await heldToken()).toBe(owner.token);
    expect(await gauge(dispatcherReservationReconcileStaleSeconds)).toBeGreaterThanOrEqual(120);
  });

  it('malformed-held: malformed queue or history is never absence', async () => {
    const owner = await loseReceipt();
    comfy.forgetPrompt(owner.promptId);
    await expireLease(owner.seeded.job.id);
    await passDeadline(owner.attemptId);

    for (const options of [
      { queueBody: '{"queue_running": 5, "queue_pending": []}' },
      { queueBody: 'not json' },
      { queueBody: '{"queue_running": [[0, "x"]], "queue_pending": []}' },
      { historyBody: '[]' },
      {
        historyBody:
          '{"p": {"prompt": [0, "q", {}, {"client_id": "c"}, []], "status": {"status_str": "success"}}}',
      },
      { historyStatus: 500 },
      { historyPadding: 500 },
    ]) {
      comfy.setOptions(options);
      await reconcileWorkerReservations(cfg());
      expect(await heldToken(), JSON.stringify(options)).toBe(owner.token);
    }
    await expectNoBusinessEffect(owner);
  });

  // A worker that was away and comes back has more than a page of newer history: the held
  // prompt is pushed out of it. The queue read is complete and does not list it, so it is not
  // executing; only its result is unknown.
  it('full-history-known-prompt: a full history page does not keep a worker reserved for a held prompt', async () => {
    const owner = await loseReceipt();
    comfy.forgetPrompt(owner.promptId);
    await expireLease(owner.seeded.job.id);
    await env.db
      .update(schema.executionAttempts)
      .set({ state: 'ACCEPTED', promptId: owner.promptId })
      .where(eq(schema.executionAttempts.id, owner.attemptId));
    comfy.setOptions({ historyPadding: 600 });

    await reconcileWorkerReservations(cfg());

    expect(await heldToken()).toBeNull();
    const attempt = await attemptRow(owner.attemptId);
    expect(attempt.resolvedAt).not.toBeNull();
    // The result stays unknown: nothing is claimed about how the prompt ended.
    expect(attempt.state).toBe('ACCEPTED');
    const [resolved] = await events(owner.seeded.job.id, 'COMFY_RESERVATION_RESOLVED');
    expect(resolved?.payload).toMatchObject({ rule: 'known_prompt_absent', truncated: true });
    await expectNoBusinessEffect(owner);
  });

  it('full-history-receiptless: a miss on a full page by client id stays unavailable', async () => {
    const owner = await loseReceipt();
    comfy.forgetPrompt(owner.promptId);
    await expireLease(owner.seeded.job.id);
    await passDeadline(owner.attemptId);
    comfy.setOptions({ historyPadding: 600 });

    await reconcileWorkerReservations(cfg());
    expect(await heldToken()).toBe(owner.token);
  });

  const noVerdict = (promptId: string, clientId: string) => ({
    prompt: [0, promptId, {}, { client_id: clientId }, []],
    outputs: {},
    status: { completed: false, messages: [] },
  });

  it('history-entry-without-verdict: an unrelated one is skipped and counted, not fatal', async () => {
    const owner = await loseReceipt();
    comfy.forgetPrompt(owner.promptId);
    await expireLease(owner.seeded.job.id);
    await passDeadline(owner.attemptId);
    comfy.setOptions({ historyExtra: { other: noVerdict('other', 'someone-else') } });

    await reconcileWorkerReservations(cfg());
    expect(await heldToken()).toBeNull();
    expect((await attemptRow(owner.attemptId)).resolvedAt).not.toBeNull();
  });

  it('history-entry-without-verdict: one for the searched client or prompt holds the worker', async () => {
    const owner = await loseReceipt();
    comfy.forgetPrompt(owner.promptId);
    await expireLease(owner.seeded.job.id);
    await passDeadline(owner.attemptId);
    const { clientId } = await attemptRow(owner.attemptId);
    comfy.setOptions({ historyExtra: { mine: noVerdict('mine', clientId) } });
    await reconcileWorkerReservations(cfg());
    expect(await heldToken()).toBe(owner.token);

    // Same for a known prompt id.
    await env.db
      .update(schema.executionAttempts)
      .set({ state: 'ACCEPTED', promptId: owner.promptId })
      .where(eq(schema.executionAttempts.id, owner.attemptId));
    comfy.setOptions({ historyExtra: { [owner.promptId]: noVerdict(owner.promptId, clientId) } });
    await reconcileWorkerReservations(cfg());
    expect(await heldToken()).toBe(owner.token);
  });

  it('foreign-queue-does-not-block-release: other clients in the queue do not hold the worker', async () => {
    const owner = await loseReceipt();
    comfy.forgetPrompt(owner.promptId);
    await expireLease(owner.seeded.job.id);
    await passDeadline(owner.attemptId);
    comfy.setOptions({ queueRunning: 2, queuePending: 1 });

    await reconcileWorkerReservations(cfg());

    expect(await heldToken()).toBeNull();
    await expectNoBusinessEffect(owner);
  });

  it('search-token-replaced: a new token placed during the search is left untouched', async () => {
    const owner = await loseReceipt();
    comfy.forgetPrompt(owner.promptId);
    await expireLease(owner.seeded.job.id);
    await passDeadline(owner.attemptId);
    const replacement = `${randomUUID()}:9:${randomUUID()}`;
    comfy.setOptions({
      onRequest: async (method, path) => {
        if (method === 'GET' && path === '/queue') {
          comfy.setOptions({});
          await redis.hset(RESERVATIONS_KEY, workerId, replacement);
        }
      },
    });

    await reconcileWorkerReservations(cfg());

    expect(await heldToken()).toBe(replacement);
    expect(await workerStatus()).toBe('BUSY');
  });

  it('late-acceptance-diagnostic-only: a prompt accepted after a not-found release changes nothing', async () => {
    const owner = await loseReceipt();
    comfy.forgetPrompt(owner.promptId);
    await expireLease(owner.seeded.job.id);
    await passDeadline(owner.attemptId);
    await reconcileWorkerReservations(cfg());
    expect(await heldToken()).toBeNull();

    // The worker finally accepts the old POST under the same client id.
    comfy.setOptions({});
    await fetch(`${comfy.url}/prompt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: {}, client_id: owner.clientId }),
    });
    await reconcileWorkerReservations(cfg());

    const attempt = await attemptRow(owner.attemptId);
    expect(attempt.promptId).toBeNull();
    expect(attempt.state).toBe('SUBMITTING');
    expect(await heldToken()).toBeNull();
    const job = await jobRow(owner.seeded.job.id);
    expect(job.status).toBe('PREPROCESSING');
    expect(job.attempts).toBe(0);
    expect(
      await env.db.select().from(schema.jobOutputs).where(eq(schema.jobOutputs.jobId, job.id)),
    ).toEqual([]);
  });

  it('skips a live owner: its hold is never classified as abandoned', async () => {
    const owner = await loseReceipt();
    comfy.forgetPrompt(owner.promptId);
    await passDeadline(owner.attemptId);
    // The lease is still live (the killed process never retired it).
    await reconcileWorkerReservations(cfg());
    expect(await heldToken()).toBe(owner.token);
    expect((await attemptRow(owner.attemptId)).promptId).toBeNull();
  });

  it('a finished known prompt is released on the scheduled pass (scheduled-history-cleanup)', async () => {
    const owner = await loseReceipt();
    comfy.finishPrompt(owner.promptId);
    await expireLease(owner.seeded.job.id);
    // The receipt had been recorded, but the owner died before releasing the worker.
    await env.db
      .update(schema.executionAttempts)
      .set({ state: 'ACCEPTED', promptId: owner.promptId })
      .where(eq(schema.executionAttempts.id, owner.attemptId));

    await reconcileWorkerReservations(cfg());

    expect(await heldToken()).toBeNull();
    expect((await attemptRow(owner.attemptId)).resolvedAt).not.toBeNull();
    expect(await gauge(dispatcherReservationFinishedHoldSeconds)).toBe(0);
  });
});
