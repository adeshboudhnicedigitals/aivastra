import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { createLogger } from '@aivastra/logger';
import { eq, sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMannequinPhase } from '../../src/job/mannequin-phase.js';
import {
  acquireComfyJob,
  OwnershipLostError,
  type OwnerToken,
  takeoverComfyJob,
} from '../../src/job/ownership.js';
import { processJob } from '../../src/job/processor.js';
import { runSweeper } from '../../src/stream/sweeper.js';
import { deregisterWorker, registerWorkers } from '../../src/worker/registry.js';
import { type ComfyMock, startComfyMock } from '../helpers/comfy-mock.js';
import { setupTestEnv, type TestEnv } from '../helpers/containers.js';
import { PAID_PATH_KINDS, PATH_FIXTURE_KEY, seedPaidJob } from '../helpers/paid-jobs.js';

// Real Postgres/Redis/MinIO and an HTTP fake worker. Every race is gated on an
// explicit signal (a request reaching the worker, a row reaching a state), never on
// a sleep that merely hopes to land in the window.
describe('paid-Comfy ownership flows', () => {
  let env: TestEnv;
  let redis: Redis;
  let comfy: ComfyMock;
  const log = createLogger('ownership-flows-test');
  const workerId = `own-flows-${randomUUID()}`;
  const sessionX = randomUUID();

  let posts = 0;
  let gate: {
    seen: Promise<void>;
    open: Promise<void>;
    hit: () => void;
    release: () => void;
  } | null = null;
  function armUploadGate() {
    let hit!: () => void;
    let release!: () => void;
    const seen = new Promise<void>((r) => {
      hit = r;
    });
    const open = new Promise<void>((r) => {
      release = r;
    });
    gate = { seen, open, hit, release };
    return gate;
  }

  const cfg = () => ({
    db: env.db,
    redis,
    comfyRedis: redis,
    pub: redis,
    storage: env.storage,
    log,
  });

  beforeAll(async () => {
    env = await setupTestEnv();
    redis = new Redis(env.redisUrl, { keyPrefix: `${workerId}:` });
    comfy = await startComfyMock();
    await env.storage.putObject(PATH_FIXTURE_KEY, Buffer.from('fixture-image'), 'image/jpeg');
  }, 60_000);

  beforeEach(async () => {
    posts = 0;
    gate = null;
    comfy.setOptions({
      fail: true,
      onRequest: async (method, path) => {
        if (method === 'POST' && path === '/prompt') posts++;
        if (method === 'POST' && path === '/upload/image' && gate) {
          gate.hit();
          await gate.open;
        }
      },
    });
    await registerWorkers(redis, [
      { id: workerId, url: comfy.url, apiKey: 'fixture', allowedJobTypes: [] },
    ]);
    await redis.setex(`worker:health:${workerId}`, 30, '1');
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await deregisterWorker(redis, workerId);
    await comfy.close();
    redis.disconnect();
    await env?.cleanup();
  });

  const jobRow = async (id: string) =>
    (await env.db.select().from(schema.jobs).where(eq(schema.jobs.id, id)))[0];
  const controlRow = async (id: string) =>
    (
      await env.db.execute(
        sql`select owner_session, generation::int as generation, owner_retired, lease_until > clock_timestamp() as live from dispatcher_job_control where job_id = ${id}`,
      )
    )[0];
  const ledgerCount = async (jobId: string) =>
    (await env.db.select().from(schema.creditLedger).where(eq(schema.creditLedger.jobId, jobId)))
      .length;
  const attemptRows = async (jobId: string) =>
    env.db.execute(sql`select state from execution_attempts where job_id = ${jobId}`);
  async function expireLease(jobId: string) {
    await env.db.execute(
      sql`update dispatcher_job_control set lease_until = clock_timestamp() - interval '1 second' where job_id = ${jobId}`,
    );
  }
  async function waitFor(check: () => boolean | Promise<boolean>) {
    const until = Date.now() + 15_000;
    while (!(await check())) {
      if (Date.now() >= until) throw new Error('fixture gate timed out');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  const processKinds = PAID_PATH_KINDS.filter((k) => k !== 'in_job_mannequin');

  describe('duplicate-live-owner', () => {
    for (const kind of processKinds) {
      it(`${kind}: a second delivery while the first uploads does nothing`, async () => {
        const { user, job, widget } = await seedPaidJob(env, kind);
        const uid = widget ? '' : user.id;
        const id = await redis.xadd('jobs:normal', '*', 'jobId', job.id, 'userId', user.id);
        if (!id) throw new Error('missing stream entry');
        const g = armUploadGate();
        const winner = processJob(
          { ...cfg(), ownerSession: randomUUID() },
          job.id,
          uid,
          'jobs:normal',
          id,
        );
        await g.seen;
        const xack = vi.spyOn(redis, 'xack');
        const ledgerBefore = await ledgerCount(job.id);
        await processJob({ ...cfg(), ownerSession: randomUUID() }, job.id, uid, 'jobs:normal', id);
        expect(xack, 'the loser must not ACK the winner’s PEL entry').not.toHaveBeenCalled();
        expect(posts, 'the loser must not upload or POST').toBe(0);
        expect(await jobRow(job.id)).toMatchObject({ status: 'PREPROCESSING', attempts: 0 });
        expect(await ledgerCount(job.id)).toBe(ledgerBefore);
        expect((await controlRow(job.id))?.generation).toBe(1);

        g.release();
        await winner;
        expect(posts, `${kind} must reach exactly one POST`).toBe(1);
      });
    }

    it('in_job_mannequin: a stale owner cannot reach the POST', async () => {
      const { job, template, face, key } = await seedPaidJob(env, 'in_job_mannequin');
      await env.db.update(schema.jobs).set({ status: 'QUEUED' }).where(eq(schema.jobs.id, job.id));
      const first = await acquireComfyJob(env.db, job.id, randomUUID(), log);
      if (first.kind !== 'Acquired') throw new Error('fixture acquire');
      await expireLease(job.id);
      await takeoverComfyJob(env.db, job.id, sessionX);
      await expect(
        runMannequinPhase(
          { ...cfg(), owner: first.owner },
          {
            jobId: job.id,
            garmentKey: key,
            faceId: face?.id ?? null,
            mannequinWorkflowTemplateId: template.id,
            jobLog: log,
            jobType: null,
          },
        ),
      ).rejects.toBeInstanceOf(OwnershipLostError);
      expect(posts).toBe(0);
      expect(await attemptRows(job.id)).toHaveLength(0);
    });
  });

  describe('stale-owner-write-rejected', () => {
    for (const kind of processKinds) {
      it(`${kind}: an owner that lost the lease during upload changes nothing`, async () => {
        const { user, job, widget } = await seedPaidJob(env, kind);
        const uid = widget ? '' : user.id;
        const id = await redis.xadd('jobs:normal', '*', 'jobId', job.id, 'userId', user.id);
        if (!id) throw new Error('missing stream entry');
        const g = armUploadGate();
        const xack = vi.spyOn(redis, 'xack');
        const stale = processJob(
          { ...cfg(), ownerSession: randomUUID() },
          job.id,
          uid,
          'jobs:normal',
          id,
        );
        await g.seen;
        await expireLease(job.id);
        expect((await takeoverComfyJob(env.db, job.id, sessionX)).kind).toBe('Acquired');
        g.release();
        await stale;

        expect(posts).toBe(0);
        expect(await jobRow(job.id)).toMatchObject({ status: 'PREPROCESSING', attempts: 0 });
        expect(await ledgerCount(job.id)).toBe(0);
        expect(await attemptRows(job.id)).toHaveLength(0);
        expect(xack).not.toHaveBeenCalled();
        expect(await controlRow(job.id)).toMatchObject({ owner_session: sessionX, generation: 2 });
      });
    }

    it('regular: an owner that lost the lease after acceptance cannot fail, refund or ACK', async () => {
      comfy.setOptions({
        fail: true,
        completionDelayMs: 2_000,
        onRequest: async (method, path) => {
          if (method === 'POST' && path === '/prompt') posts++;
        },
      });
      const { user, job } = await seedPaidJob(env, 'regular');
      const id = await redis.xadd('jobs:normal', '*', 'jobId', job.id, 'userId', user.id);
      if (!id) throw new Error('missing stream entry');
      const xack = vi.spyOn(redis, 'xack');
      const stale = processJob(
        { ...cfg(), ownerSession: randomUUID() },
        job.id,
        user.id,
        'jobs:normal',
        id,
      );
      await waitFor(async () => (await attemptRows(job.id)).some((r) => r.state === 'ACCEPTED'));
      await expireLease(job.id);
      expect((await takeoverComfyJob(env.db, job.id, sessionX)).kind).toBe('Acquired');
      await stale;

      expect(posts).toBe(1);
      // The failed execution would have counted an attempt, refunded or requeued.
      expect(await jobRow(job.id)).toMatchObject({ status: 'GENERATING', attempts: 0 });
      expect(await ledgerCount(job.id)).toBe(0);
      expect(await attemptRows(job.id)).toEqual([{ state: 'ACCEPTED' }]);
      expect(xack).not.toHaveBeenCalled();
      expect(await controlRow(job.id)).toMatchObject({ owner_session: sessionX, generation: 2 });
    });
  });

  describe('retry-visible-after-yield', () => {
    it('a handleFailure retry retires authority, so the replacement acquires at once', async () => {
      const { user, job } = await seedPaidJob(env, 'regular');
      const id = await redis.xadd('jobs:normal', '*', 'jobId', job.id, 'userId', user.id);
      if (!id) throw new Error('missing stream entry');
      await processJob(
        { ...cfg(), ownerSession: randomUUID() },
        job.id,
        user.id,
        'jobs:normal',
        id,
      );
      expect(await jobRow(job.id)).toMatchObject({ status: 'QUEUED', attempts: 1 });
      expect(await controlRow(job.id)).toMatchObject({ generation: 1, owner_retired: true });

      // The replacement message, consumed immediately by a different process.
      await processJob(
        { ...cfg(), ownerSession: randomUUID() },
        job.id,
        user.id,
        'jobs:normal',
        id,
      );
      expect((await controlRow(job.id))?.generation).toBe(2);
      expect(await jobRow(job.id)).toMatchObject({ status: 'FAILED', attempts: 2 });
      expect(await ledgerCount(job.id)).toBe(1);
    });

    it('a no-worker requeue holds a live lease through its sleep, then retires it', async () => {
      await deregisterWorker(redis, workerId);
      const { user, job } = await seedPaidJob(env, 'regular');
      const id = await redis.xadd('jobs:normal', '*', 'jobId', job.id, 'userId', user.id);
      if (!id) throw new Error('missing stream entry');
      const xack = vi.spyOn(redis, 'xack');
      const first = processJob(
        { ...cfg(), ownerSession: randomUUID() },
        job.id,
        user.id,
        'jobs:normal',
        id,
      );
      // QUEUED and still leased: the state a duplicate delivery must not mistake for free.
      await waitFor(async () => {
        const c = await controlRow(job.id);
        return (await jobRow(job.id))?.status === 'QUEUED' && c?.live === true;
      });
      expect((await acquireComfyJob(env.db, job.id, randomUUID(), log)).kind).toBe('LiveOwner');
      const callsBefore = xack.mock.calls.length;
      await processJob(
        { ...cfg(), ownerSession: randomUUID() },
        job.id,
        user.id,
        'jobs:normal',
        id,
      );
      expect(xack.mock.calls.length).toBe(callsBefore);
      expect((await jobRow(job.id))?.attempts).toBe(0);

      await first;
      expect(await controlRow(job.id)).toMatchObject({ generation: 1, owner_retired: true });
      expect(await jobRow(job.id)).toMatchObject({ status: 'QUEUED', attempts: 0 });
      expect(await acquireComfyJob(env.db, job.id, randomUUID(), log)).toMatchObject({
        kind: 'Acquired',
        owner: { generation: 2 },
      });
    }, 30_000);
  });

  describe('sweeper', () => {
    async function stuckJob() {
      const { user, job } = await seedPaidJob(env, 'regular');
      const acquired = await acquireComfyJob(env.db, job.id, randomUUID(), log);
      if (acquired.kind !== 'Acquired') throw new Error('fixture acquire');
      await env.db
        .update(schema.jobs)
        .set({
          status: 'GENERATING',
          startedAt: new Date(Date.now() - 20 * 60_000),
          creditsCharged: 1,
        })
        .where(eq(schema.jobs.id, job.id));
      return { user, job, owner: acquired.owner };
    }
    const balance = async (userId: string) =>
      (
        await env.db.select().from(schema.userCredits).where(eq(schema.userCredits.userId, userId))
      )[0]?.balance;

    it('skips a job whose owner still holds a live lease, and a sleeping QUEUED one', async () => {
      const { user, job } = await stuckJob();
      await runSweeper(env.db, redis, redis, log, sessionX);
      expect(await jobRow(job.id)).toMatchObject({ status: 'GENERATING' });
      expect(await balance(user.id)).toBe(4);
      expect(await ledgerCount(job.id)).toBe(0);

      await env.db.update(schema.jobs).set({ status: 'QUEUED' }).where(eq(schema.jobs.id, job.id));
      await runSweeper(env.db, redis, redis, log, sessionX);
      expect((await jobRow(job.id))?.status).toBe('QUEUED');
    });

    it('refunds an expired owner’s job exactly once, under a fresh generation', async () => {
      const { user, job } = await stuckJob();
      await expireLease(job.id);
      await runSweeper(env.db, redis, redis, log, sessionX);
      expect(await jobRow(job.id)).toMatchObject({
        status: 'FAILED',
        errorCode: 'STUCK_IN_FLIGHT',
      });
      expect(await balance(user.id)).toBe(5);
      expect(await controlRow(job.id)).toMatchObject({ owner_session: sessionX, generation: 2 });
      await runSweeper(env.db, redis, redis, log, sessionX);
      expect(await balance(user.id)).toBe(5);
      expect(await ledgerCount(job.id)).toBe(1);
    });

    it('refunds an ownerless legacy in-flight job under a new control row', async () => {
      const { user, job } = await seedPaidJob(env, 'regular');
      await env.db
        .update(schema.jobs)
        .set({
          status: 'GENERATING',
          startedAt: new Date(Date.now() - 20 * 60_000),
          creditsCharged: 1,
        })
        .where(eq(schema.jobs.id, job.id));
      await runSweeper(env.db, redis, redis, log, sessionX);
      expect((await jobRow(job.id))?.status).toBe('FAILED');
      expect(await balance(user.id)).toBe(5);
      expect(await controlRow(job.id)).toMatchObject({ owner_session: sessionX, generation: 1 });
    });
  });

  describe('legacy recovery of an ownerless in-flight job', () => {
    async function inFlight(attempts: number) {
      const { user, job } = await seedPaidJob(env, 'regular');
      await env.db
        .update(schema.jobs)
        .set({ status: 'GENERATING', attempts, creditsCharged: 1 })
        .where(eq(schema.jobs.id, job.id));
      const id = await redis.xadd('jobs:normal', '*', 'jobId', job.id, 'userId', user.id);
      if (!id) throw new Error('missing stream entry');
      return { user, job, id };
    }

    it('first crash: counted, requeued, authority retired under a fresh generation', async () => {
      const { user, job, id } = await inFlight(0);
      await processJob({ ...cfg(), ownerSession: sessionX }, job.id, user.id, 'jobs:normal', id);
      expect(await jobRow(job.id)).toMatchObject({ status: 'QUEUED', attempts: 1 });
      expect(await controlRow(job.id)).toMatchObject({
        owner_session: sessionX,
        generation: 1,
        owner_retired: true,
      });
      expect(posts).toBe(0);
    });

    it('second crash: terminated with exactly one refund', async () => {
      const { user, job, id } = await inFlight(1);
      await processJob({ ...cfg(), ownerSession: sessionX }, job.id, user.id, 'jobs:normal', id);
      expect(await jobRow(job.id)).toMatchObject({ status: 'FAILED', attempts: 2 });
      expect(await ledgerCount(job.id)).toBe(1);
    });

    it('a live owner is never treated as crashed', async () => {
      const { user, job } = await seedPaidJob(env, 'regular');
      const owner: OwnerToken | undefined = await (async () => {
        const a = await acquireComfyJob(env.db, job.id, randomUUID(), log);
        return a.kind === 'Acquired' ? a.owner : undefined;
      })();
      expect(owner).toBeDefined();
      await env.db
        .update(schema.jobs)
        .set({ status: 'GENERATING' })
        .where(eq(schema.jobs.id, job.id));
      const id = await redis.xadd('jobs:normal', '*', 'jobId', job.id, 'userId', user.id);
      if (!id) throw new Error('missing stream entry');
      await processJob({ ...cfg(), ownerSession: sessionX }, job.id, user.id, 'jobs:normal', id);
      expect(await jobRow(job.id)).toMatchObject({ status: 'GENERATING', attempts: 0 });
      expect(await ledgerCount(job.id)).toBe(0);
    });
  });
});
