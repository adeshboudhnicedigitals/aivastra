import { type ChildProcess, fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { createLogger } from '@aivastra/logger';
import { eq, sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  acquireComfyJob,
  renewLeases,
  takeoverComfyJob,
  trackOwnedJob,
  untrackOwnedJob,
} from '../../src/job/ownership.js';
import { processJob } from '../../src/job/processor.js';
import { settleComfyJob } from '../../src/job/settlement.js';
import { runSweeper } from '../../src/stream/sweeper.js';
import { deregisterWorker, registerWorkers } from '../../src/worker/registry.js';
import { type ComfyMock, startComfyMock } from '../helpers/comfy-mock.js';
import { setupTestEnv, type TestEnv } from '../helpers/containers.js';
import { PATH_FIXTURE_KEY, type PaidPathKind, seedPaidJob } from '../helpers/paid-jobs.js';

// The admin-cancel side is the real apps/api helper, not a reimplementation: the
// double refund only exists because those helpers and the dispatcher's refund code
// disagree about what "already refunded" means.
type ApiLedger = typeof import('../../../api/src/modules/credits/ledger.js');
type ApiShopifyLedger = typeof import('../../../api/src/modules/credits/shopify-ledger.js');

// Payer families (the null-user_id kiosk shape has no creation path, so it is not a fixture).
const PAYERS = ['regular', 'merchant_widget', 'shopify'] as const satisfies readonly PaidPathKind[];
const COST = 2;
const START_BALANCE = 4;

describe('fenced settlement', () => {
  let env: TestEnv;
  let redis: Redis;
  let comfy: ComfyMock;
  let api: ApiLedger;
  let apiShopify: ApiShopifyLedger;
  const log = createLogger('fenced-settlement-test');
  const workerId = `settle-${randomUUID()}`;

  let uploadSeen: () => void = () => {};
  let uploadOpen: Promise<void> = Promise.resolve();
  function armUploadGate() {
    let release!: () => void;
    const seen = new Promise<void>((resolve) => {
      uploadSeen = resolve;
    });
    uploadOpen = new Promise<void>((resolve) => {
      release = resolve;
    });
    return { seen, release };
  }

  beforeAll(async () => {
    env = await setupTestEnv();
    redis = new Redis(env.redisUrl, { keyPrefix: `${workerId}:` });
    comfy = await startComfyMock();
    api = await import('../../../api/src/modules/credits/ledger.js');
    apiShopify = await import('../../../api/src/modules/credits/shopify-ledger.js');
    await env.storage.putObject(PATH_FIXTURE_KEY, Buffer.from('fixture-image'), 'image/jpeg');
  }, 60_000);

  beforeEach(async () => {
    comfy.setOptions({
      fail: true,
      onRequest: async (method, path) => {
        if (method === 'POST' && path === '/upload/image') {
          uploadSeen();
          await uploadOpen;
        }
      },
    });
    await registerWorkers(redis, [
      { id: workerId, url: comfy.url, apiKey: 'fixture', allowedJobTypes: [] },
    ]);
    await redis.setex(`worker:health:${workerId}`, 30, '1');
  });
  afterAll(async () => {
    await deregisterWorker(redis, workerId);
    await comfy.close();
    redis.disconnect();
    await env?.cleanup();
  });

  const cfg = () => ({
    db: env.db,
    redis,
    comfyRedis: redis,
    pub: redis,
    storage: env.storage,
    log,
  });

  /** A paid job of the given payer family with its payer's balance seeded, one failure from exhaustion. */
  async function seedFamily(kind: (typeof PAYERS)[number], cost = COST, source?: string) {
    const seeded = await seedPaidJob(env, kind, { merchantUserOnJob: true, cost });
    if (source) {
      await env.db.update(schema.jobs).set({ source }).where(eq(schema.jobs.id, seeded.job.id));
    }
    if (kind === 'shopify') {
      const storeId = (
        await env.db.select().from(schema.jobs).where(eq(schema.jobs.id, seeded.job.id))
      )[0]?.shopifyStoreId;
      if (!storeId) throw new Error('missing store');
      await env.db.insert(schema.shopifyStoreCredits).values({ storeId, balance: START_BALANCE });
    }
    // MAX_ATTEMPTS is 2: starting at 1, the first failure is the terminal one.
    await env.db.update(schema.jobs).set({ attempts: 1 }).where(eq(schema.jobs.id, seeded.job.id));
    return seeded;
  }

  /** What POST /admin/jobs/:id/cancel does for this payer, via the real API helpers. */
  async function adminCancel(kind: (typeof PAYERS)[number], jobId: string) {
    const [job] = await env.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    if (!job) throw new Error('missing job');
    if (kind === 'shopify') {
      if (!job.shopifyStoreId) throw new Error('missing store');
      await apiShopify.refundStoreAndMarkCancelled(
        env.db,
        job.shopifyStoreId,
        job.creditsCharged,
        jobId,
        'REFUND_ADMIN_CANCEL',
        'ADMIN_CANCEL',
      );
      return;
    }
    await env.db
      .update(schema.jobs)
      .set({ status: 'CANCELLED', errorCode: 'ADMIN_CANCEL' })
      .where(eq(schema.jobs.id, jobId));
    if (!job.userId) throw new Error('missing job owner');
    await api.refund(env.db, job.userId, job.creditsCharged, jobId, 'REFUND_ADMIN_CANCEL');
  }

  async function ledgerReasons(kind: (typeof PAYERS)[number], jobId: string) {
    const rows =
      kind === 'shopify'
        ? await env.db
            .select({
              reason: schema.shopifyCreditLedger.reason,
              delta: schema.shopifyCreditLedger.delta,
            })
            .from(schema.shopifyCreditLedger)
            .where(eq(schema.shopifyCreditLedger.jobId, jobId))
        : await env.db
            .select({ reason: schema.creditLedger.reason, delta: schema.creditLedger.delta })
            .from(schema.creditLedger)
            .where(eq(schema.creditLedger.jobId, jobId));
    return rows.filter((r) => r.delta > 0).map((r) => r.reason);
  }

  async function balance(
    kind: (typeof PAYERS)[number],
    seeded: Awaited<ReturnType<typeof seedFamily>>,
  ) {
    if (kind === 'shopify') {
      const [job] = await env.db
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.id, seeded.job.id));
      const [row] = await env.db
        .select()
        .from(schema.shopifyStoreCredits)
        .where(eq(schema.shopifyStoreCredits.storeId, job?.shopifyStoreId as string));
      return row?.balance;
    }
    const [row] = await env.db
      .select()
      .from(schema.userCredits)
      .where(eq(schema.userCredits.userId, seeded.user.id));
    return row?.balance;
  }

  /** Runs the dispatcher on the job; the admin cancels while its input upload is held; then it fails terminally. */
  async function cancelMidRunThenFail(kind: (typeof PAYERS)[number]) {
    const seeded = await seedFamily(kind);
    const id = await redis.xadd(
      'jobs:normal',
      '*',
      'jobId',
      seeded.job.id,
      'userId',
      seeded.user.id,
    );
    if (!id) throw new Error('missing stream entry');
    const gate = armUploadGate();
    const running = processJob(
      { ...cfg(), ownerSession: randomUUID() },
      seeded.job.id,
      seeded.widget ? '' : seeded.user.id,
      'jobs:normal',
      id,
    );
    await gate.seen;
    await adminCancel(kind, seeded.job.id);
    gate.release();
    await running;
    return seeded;
  }

  /** Every case asserts the final status AND the exact refund rows, so each bug fails for its real reason. */
  async function expectCancelledOnceRefunded(
    kind: (typeof PAYERS)[number],
    seeded: Awaited<ReturnType<typeof seedFamily>>,
  ) {
    const [job] = await env.db.select().from(schema.jobs).where(eq(schema.jobs.id, seeded.job.id));
    expect(job?.status).toBe('CANCELLED');
    const failed = await env.db.execute(
      sql`select 1 from job_events where job_id = ${seeded.job.id} and event_type = 'FAILED'`,
    );
    expect(failed).toHaveLength(0);
    expect(await ledgerReasons(kind, seeded.job.id)).toEqual(['REFUND_ADMIN_CANCEL']);
    expect(await balance(kind, seeded)).toBe(START_BALANCE + COST);
  }

  describe('admin-cancel-then-dispatcher-fail (bug 1)', () => {
    for (const kind of PAYERS) {
      it(`${kind}: one refund (REFUND_ADMIN_CANCEL), status stays CANCELLED`, async () => {
        await expectCancelledOnceRefunded(kind, await cancelMidRunThenFail(kind));
      });
    }
  });

  describe('terminal-not-overwritten (bug 2)', () => {
    for (const kind of PAYERS) {
      it(`${kind}: a CANCELLED job is not rewritten to FAILED and is not refunded again`, async () => {
        await expectCancelledOnceRefunded(kind, await cancelMidRunThenFail(kind));
      });
    }
  });
  // ── direct settlement: payers, reasons, generations, races ────────────────────────────

  const FAMILIES = [
    { name: 'user', kind: 'regular', source: undefined, payer: 'user' },
    // Merchant-catalog and dev-API jobs are jobs.user_id-owned: the same refund rule.
    { name: 'merchant/dev-API', kind: 'regular', source: 'api_catalog', payer: 'user' },
    { name: 'widget', kind: 'merchant_widget', source: undefined, payer: 'merchant_user' },
    { name: 'shopify', kind: 'shopify', source: undefined, payer: 'store' },
  ] as const;

  async function acquire(jobId: string, session = randomUUID()) {
    const a = await acquireComfyJob(env.db, jobId, session, log);
    if (a.kind !== 'Acquired') throw new Error(`not acquired: ${a.kind}`);
    return a.owner;
  }
  async function seedActiveAttempt(jobId: string) {
    const [attempt] = await env.db
      .insert(schema.executionAttempts)
      .values({
        jobId,
        attemptNo: 1,
        phase: 'main',
        clientId: `av:${jobId}:1:main`,
        state: 'ACCEPTED',
        promptId: 'prompt-1',
        contract: { version: 1 },
      })
      .returning();
    if (!attempt) throw new Error('missing attempt');
    await env.db
      .update(schema.dispatcherJobControl)
      .set({ activeAttemptId: attempt.id })
      .where(eq(schema.dispatcherJobControl.jobId, jobId));
    return attempt.id;
  }
  const expireLease = (jobId: string) =>
    env.db.execute(
      sql`update dispatcher_job_control set lease_until = clock_timestamp() - interval '1 second' where job_id = ${jobId}`,
    );
  const statusOf = async (jobId: string) =>
    (await env.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId)))[0]?.status;
  const eventCount = async (jobId: string, type: string) =>
    (
      await env.db.execute(
        sql`select 1 from job_events where job_id = ${jobId} and event_type = ${type}`,
      )
    ).length;
  const outputCount = async (jobId: string) =>
    (await env.db.select().from(schema.jobOutputs).where(eq(schema.jobOutputs.jobId, jobId)))
      .length;
  /** Every ledger row for the job, zero-delta included: zero cost must write none. */
  async function ledgerRowCount(kind: (typeof PAYERS)[number], jobId: string) {
    return kind === 'shopify'
      ? (
          await env.db
            .select()
            .from(schema.shopifyCreditLedger)
            .where(eq(schema.shopifyCreditLedger.jobId, jobId))
        ).length
      : (
          await env.db
            .select()
            .from(schema.creditLedger)
            .where(eq(schema.creditLedger.jobId, jobId))
        ).length;
  }
  const failedOutcome = { kind: 'failed', errorCode: 'TEST_FAIL' } as const;

  describe('fenced-settlement-all-payers', () => {
    for (const family of FAMILIES) {
      for (const cost of [COST, 0]) {
        it(`${family.name} at cost ${cost}: refunds exactly the charge to the right account, once`, async () => {
          const seeded = await seedFamily(family.kind, cost, family.source);
          const owner = await acquire(seeded.job.id);
          const attemptId = await seedActiveAttempt(seeded.job.id);

          const result = await settleComfyJob(env.db, { owner }, failedOutcome, log);
          expect(result).toMatchObject({
            kind: 'settled',
            status: 'FAILED',
            refunded: cost,
            payer: family.payer,
          });
          expect(await statusOf(seeded.job.id)).toBe('FAILED');
          expect(await eventCount(seeded.job.id, 'FAILED')).toBe(1);
          expect(await ledgerRowCount(family.kind, seeded.job.id)).toBe(cost > 0 ? 1 : 0);
          expect(await ledgerReasons(family.kind, seeded.job.id)).toEqual(
            cost > 0 ? ['JOB_FAIL_REFUND'] : [],
          );
          expect(await balance(family.kind, seeded)).toBe(START_BALANCE + cost);
          // The attempt row commits in the same transaction as the status and refund.
          const [attempt] = await env.db
            .select()
            .from(schema.executionAttempts)
            .where(eq(schema.executionAttempts.id, attemptId));
          expect(attempt?.state).toBe('FAILED');
          expect(await controlRetired(seeded.job.id)).toBe(true);
        });
      }
    }

    it('a completed settlement stores the output and refunds nothing', async () => {
      const seeded = await seedFamily('regular');
      const owner = await acquire(seeded.job.id);
      const attemptId = await seedActiveAttempt(seeded.job.id);
      const result = await settleComfyJob(
        env.db,
        { owner },
        { kind: 'completed', output: { resultKey: 'private/out.png' } },
        log,
      );
      expect(result).toMatchObject({ kind: 'settled', status: 'COMPLETED', refunded: 0 });
      expect(await outputCount(seeded.job.id)).toBe(1);
      expect(await ledgerRowCount('regular', seeded.job.id)).toBe(0);
      const [attempt] = await env.db
        .select()
        .from(schema.executionAttempts)
        .where(eq(schema.executionAttempts.id, attemptId));
      expect(attempt?.state).toBe('SUCCEEDED');
      expect(attempt?.resolvedAt).not.toBeNull();
    });

    it('widget payer: jobs.user_id is the merchant owning user, so every refund rule agrees', async () => {
      // The sweeper used to refund jobs.user_id first, and the dispatcher's widget path
      // merchants.user_id. They are one account only because widget creation stores
      // merchantUserId on the job; settlement uses the merchant lookup.
      const seeded = await seedFamily('merchant_widget');
      const [job] = await env.db
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.id, seeded.job.id));
      const [merchant] = await env.db
        .select()
        .from(schema.merchants)
        .where(eq(schema.merchants.id, job?.merchantId as string));
      expect(job?.userId).toBe(merchant?.userId);
    });
  });

  async function controlRetired(jobId: string) {
    const rows = await env.db.execute(
      sql`select owner_retired from dispatcher_job_control where job_id = ${jobId}`,
    );
    return (rows[0] as { owner_retired: boolean } | undefined)?.owner_retired;
  }

  describe('duplicate-settle-different-reasons', () => {
    for (const family of FAMILIES) {
      it(`${family.name}: cancelled then failed (and the reverse) refunds once`, async () => {
        const first = await seedFamily(family.kind, COST, family.source);
        const firstOwner = await acquire(first.job.id);
        await settleComfyJob(env.db, { owner: firstOwner }, { kind: 'cancelled' }, log);
        const second = await settleComfyJob(
          env.db,
          { takeover: { jobId: first.job.id, session: randomUUID() } },
          failedOutcome,
          log,
        );
        expect(second).toEqual({ kind: 'already_terminal', status: 'CANCELLED' });
        expect(await ledgerReasons(family.kind, first.job.id)).toEqual(['JOB_CANCEL_REFUND']);
        expect(await statusOf(first.job.id)).toBe('CANCELLED');
        expect(await balance(family.kind, first)).toBe(START_BALANCE + COST);

        const reverse = await seedFamily(family.kind, COST, family.source);
        const reverseOwner = await acquire(reverse.job.id);
        await settleComfyJob(env.db, { owner: reverseOwner }, failedOutcome, log);
        const again = await settleComfyJob(
          env.db,
          { takeover: { jobId: reverse.job.id, session: randomUUID() } },
          { kind: 'cancelled' },
          log,
        );
        expect(again).toEqual({ kind: 'already_terminal', status: 'FAILED' });
        expect(await ledgerReasons(family.kind, reverse.job.id)).toEqual(['JOB_FAIL_REFUND']);
        expect(await statusOf(reverse.job.id)).toBe('FAILED');
        expect(await balance(family.kind, reverse)).toBe(START_BALANCE + COST);
      });
    }

    it('a refund of a different reason already on the ledger blocks the dispatcher refund', async () => {
      const seeded = await seedFamily('regular');
      await env.db.insert(schema.creditLedger).values({
        userId: seeded.user.id,
        jobId: seeded.job.id,
        delta: COST,
        reason: 'REFUND_CANCELLED',
      });
      const owner = await acquire(seeded.job.id);
      const result = await settleComfyJob(env.db, { owner }, failedOutcome, log);
      expect(result).toMatchObject({ kind: 'settled', refunded: 0 });
      expect(await ledgerReasons('regular', seeded.job.id)).toEqual(['REFUND_CANCELLED']);
    });
  });

  describe('terminal-not-overwritten (settlement fence)', () => {
    for (const terminal of ['COMPLETED', 'FAILED', 'CANCELLED'] as const) {
      it(`a ${terminal} job is untouched by a later cancelled settlement (the COMPARISON_INVALID write)`, async () => {
        const seeded = await seedFamily('regular', 0);
        await env.db
          .update(schema.jobs)
          .set({ status: terminal })
          .where(eq(schema.jobs.id, seeded.job.id));
        const result = await settleComfyJob(
          env.db,
          { takeover: { jobId: seeded.job.id, session: randomUUID() } },
          { kind: 'cancelled', errorCode: 'COMPARISON_INVALID' },
          log,
        );
        expect(result).toEqual({ kind: 'already_terminal', status: terminal });
        expect(await statusOf(seeded.job.id)).toBe(terminal);
        expect(await eventCount(seeded.job.id, 'CANCELLED')).toBe(0);
      });
    }
  });

  describe('stale-generation-settle-rejected', () => {
    it('an old owner settling after a takeover is lost, with no row changes', async () => {
      const seeded = await seedFamily('regular');
      const oldOwner = await acquire(seeded.job.id);
      await expireLease(seeded.job.id);
      const taken = await takeoverComfyJob(env.db, seeded.job.id, randomUUID());
      expect(taken.kind).toBe('Acquired');

      const stale = await settleComfyJob(env.db, { owner: oldOwner }, failedOutcome, log);
      expect(stale).toEqual({ kind: 'lost' });
      expect(await statusOf(seeded.job.id)).toBe('PREPROCESSING');
      expect(await ledgerRowCount('regular', seeded.job.id)).toBe(0);
      expect(await balance('regular', seeded)).toBe(START_BALANCE);
      expect(await eventCount(seeded.job.id, 'FAILED')).toBe(0);

      if (taken.kind !== 'Acquired') throw new Error('unreachable');
      const current = await settleComfyJob(env.db, { owner: taken.owner }, failedOutcome, log);
      expect(current).toMatchObject({ kind: 'settled', refunded: COST });
    });
  });

  describe('completion-vs-refund', () => {
    // Whichever side commits first wins; the other is a no-op. Either the job is COMPLETED
    // with its output and no refund, or it is finished some other way with one refund and
    // no output row.
    async function expectOneWinner(
      family: (typeof FAMILIES)[number],
      seeded: Awaited<ReturnType<typeof seedFamily>>,
    ) {
      const status = await statusOf(seeded.job.id);
      if (status === 'COMPLETED') {
        expect(await outputCount(seeded.job.id)).toBe(1);
        expect(await ledgerRowCount(family.kind, seeded.job.id)).toBe(0);
        expect(await balance(family.kind, seeded)).toBe(START_BALANCE);
      } else {
        expect(['FAILED', 'CANCELLED']).toContain(status);
        expect(await outputCount(seeded.job.id)).toBe(0);
        expect(await ledgerRowCount(family.kind, seeded.job.id)).toBe(1);
        expect(await balance(family.kind, seeded)).toBe(START_BALANCE + COST);
      }
    }

    for (const family of FAMILIES) {
      it(`${family.name}: completion racing an API cancel has exactly one winner`, async () => {
        const seeded = await seedFamily(family.kind, COST, family.source);
        const owner = await acquire(seeded.job.id);
        const completion = settleComfyJob(
          env.db,
          { owner },
          { kind: 'completed', output: { resultKey: 'private/race.png' } },
          log,
        );
        const cancel =
          family.kind === 'shopify'
            ? apiShopify.refundStoreAndMarkCancelled(
                env.db,
                (
                  await env.db.select().from(schema.jobs).where(eq(schema.jobs.id, seeded.job.id))
                )[0]?.shopifyStoreId as string,
                COST,
                seeded.job.id,
                'REFUND_ADMIN_CANCEL',
                'ADMIN_CANCEL',
              )
            : api.cancelJobAndRefund(env.db, {
                jobId: seeded.job.id,
                userId: seeded.user.id,
                amount: COST,
                refundReason: 'REFUND_ADMIN_CANCEL',
                errorCode: 'ADMIN_CANCEL',
              });
        await Promise.all([completion, cancel]);
        await expectOneWinner(family, seeded);
      });

      it(`${family.name}: completion racing the sweeper has exactly one winner`, async () => {
        const seeded = await seedFamily(family.kind, COST, family.source);
        const owner = await acquire(seeded.job.id);
        // A lease the sweeper may take over; the completing owner then races it.
        await expireLease(seeded.job.id);
        await Promise.all([
          settleComfyJob(
            env.db,
            { owner },
            { kind: 'completed', output: { resultKey: 'private/race.png' } },
            log,
          ),
          settleComfyJob(
            env.db,
            { takeover: { jobId: seeded.job.id, session: randomUUID() } },
            failedOutcome,
            log,
          ),
        ]);
        await expectOneWinner(family, seeded);
      });
    }
  });

  describe('no active attempt pointer', () => {
    it('a job with no active_attempt_id settles: the attempt write is skipped, not failed', async () => {
      // In flight before B1, or failed in pre-flight before any submission: no attempt row.
      const seeded = await seedFamily('regular');
      const owner = await acquire(seeded.job.id);
      const result = await settleComfyJob(env.db, { owner }, failedOutcome, log);
      expect(result).toMatchObject({ kind: 'settled', status: 'FAILED', refunded: COST });
      expect(await statusOf(seeded.job.id)).toBe('FAILED');
      expect(await balance('regular', seeded)).toBe(START_BALANCE + COST);
      expect(
        await env.db
          .select()
          .from(schema.executionAttempts)
          .where(eq(schema.executionAttempts.jobId, seeded.job.id)),
      ).toEqual([]);
    });

    it('an attempt row the control row does not point at is left untouched', async () => {
      const seeded = await seedFamily('regular');
      const owner = await acquire(seeded.job.id);
      const attemptId = await seedActiveAttempt(seeded.job.id);
      await env.db
        .update(schema.dispatcherJobControl)
        .set({ activeAttemptId: null })
        .where(eq(schema.dispatcherJobControl.jobId, seeded.job.id));
      const result = await settleComfyJob(env.db, { owner }, failedOutcome, log);
      expect(result.kind).toBe('settled');
      const [attempt] = await env.db
        .select()
        .from(schema.executionAttempts)
        .where(eq(schema.executionAttempts.id, attemptId));
      expect(attempt?.state).toBe('ACCEPTED');
    });
  });

  describe('unowned authority (PixVerse video lane)', () => {
    /** A video-shaped job: in flight, billed to a user, and never given a control row. */
    async function seedUnowned(status = 'GENERATING') {
      const seeded = await seedFamily('regular');
      await env.db
        .update(schema.jobs)
        .set({ status, source: 'catalog_video' })
        .where(eq(schema.jobs.id, seeded.job.id));
      return seeded;
    }
    const controlRows = async (jobId: string) =>
      env.db
        .select()
        .from(schema.dispatcherJobControl)
        .where(eq(schema.dispatcherJobControl.jobId, jobId));

    it('settles with the terminal fence and refund, and never creates a control row', async () => {
      const seeded = await seedUnowned();
      const result = await settleComfyJob(
        env.db,
        { unowned: { jobId: seeded.job.id } },
        failedOutcome,
        log,
      );
      expect(result).toMatchObject({ kind: 'settled', status: 'FAILED', refunded: COST });
      expect(await ledgerReasons('regular', seeded.job.id)).toEqual(['JOB_FAIL_REFUND']);
      expect(await balance('regular', seeded)).toBe(START_BALANCE + COST);
      expect(await controlRows(seeded.job.id)).toEqual([]);
      expect(
        await env.db
          .select()
          .from(schema.executionAttempts)
          .where(eq(schema.executionAttempts.jobId, seeded.job.id)),
      ).toEqual([]);
    });

    it('leaves a CANCELLED job cancelled and refunds nothing more', async () => {
      const seeded = await seedUnowned('CANCELLED');
      await env.db.insert(schema.creditLedger).values({
        userId: seeded.user.id,
        jobId: seeded.job.id,
        delta: COST,
        reason: 'REFUND_ADMIN_CANCEL',
      });
      const result = await settleComfyJob(
        env.db,
        { unowned: { jobId: seeded.job.id } },
        failedOutcome,
        log,
      );
      expect(result).toEqual({ kind: 'already_terminal', status: 'CANCELLED' });
      expect(await statusOf(seeded.job.id)).toBe('CANCELLED');
      expect(await ledgerReasons('regular', seeded.job.id)).toEqual(['REFUND_ADMIN_CANCEL']);
      expect(await controlRows(seeded.job.id)).toEqual([]);
    });

    it('skips a refund when another reason is already on the ledger', async () => {
      const seeded = await seedUnowned();
      await env.db.insert(schema.creditLedger).values({
        userId: seeded.user.id,
        jobId: seeded.job.id,
        delta: COST,
        reason: 'REFUND_CANCELLED',
      });
      const result = await settleComfyJob(
        env.db,
        { unowned: { jobId: seeded.job.id } },
        failedOutcome,
        log,
      );
      expect(result).toMatchObject({ kind: 'settled', refunded: 0 });
      expect(await ledgerReasons('regular', seeded.job.id)).toEqual(['REFUND_CANCELLED']);
      expect(await controlRows(seeded.job.id)).toEqual([]);
    });
  });

  describe('attempt-write-failure-rolls-back', () => {
    it('a failing attempt update rolls the whole settlement back and ACKs nothing', async () => {
      const seeded = await seedFamily('regular');
      const id = await redis.xadd(
        'jobs:normal',
        '*',
        'jobId',
        seeded.job.id,
        'userId',
        seeded.user.id,
      );
      if (!id) throw new Error('missing stream entry');
      await env.db.execute(
        sql`create function reject_failed_attempt() returns trigger language plpgsql as $$ begin raise exception 'attempt write unavailable'; end $$`,
      );
      await env.db.execute(
        sql`create trigger reject_failed_attempt before update on execution_attempts for each row when (new.state = 'FAILED') execute function reject_failed_attempt()`,
      );
      const xack = vi.spyOn(redis, 'xack');
      try {
        await expect(
          processJob(
            { ...cfg(), ownerSession: randomUUID() },
            seeded.job.id,
            seeded.user.id,
            'jobs:normal',
            id,
          ),
        ).rejects.toThrow();
      } finally {
        await env.db.execute(sql`drop trigger reject_failed_attempt on execution_attempts`);
        await env.db.execute(sql`drop function reject_failed_attempt()`);
      }
      expect(await statusOf(seeded.job.id)).not.toBe('FAILED');
      expect(await ledgerRowCount('regular', seeded.job.id)).toBe(0);
      expect(await balance('regular', seeded)).toBe(START_BALANCE);
      expect(await eventCount(seeded.job.id, 'FAILED')).toBe(0);
      expect(xack).not.toHaveBeenCalledWith('jobs:normal', 'dispatcher-cg', id);
    });
  });

  describe('renewal-generation-matched', () => {
    it('a leftover entry from an earlier generation never extends the newer lease', async () => {
      const seeded = await seedFamily('regular');
      const session = randomUUID();
      const first = await acquire(seeded.job.id, session);
      trackOwnedJob(first);
      // Re-acquired by the same session (a retry): generation 2, with the generation-1
      // entry still in the in-flight set.
      await env.db
        .update(schema.dispatcherJobControl)
        .set({ ownerRetired: true })
        .where(eq(schema.dispatcherJobControl.jobId, seeded.job.id));
      await env.db
        .update(schema.jobs)
        .set({ status: 'QUEUED' })
        .where(eq(schema.jobs.id, seeded.job.id));
      const second = await acquire(seeded.job.id, session);
      expect(second.generation).toBe(first.generation + 1);
      await env.db.execute(
        sql`update dispatcher_job_control set lease_until = clock_timestamp() + interval '5 seconds' where job_id = ${seeded.job.id}`,
      );

      expect(await renewLeases(env.db, session)).toBe(0);
      const [row] = await env.db.execute(
        sql`select extract(epoch from (lease_until - clock_timestamp())) as secs from dispatcher_job_control where job_id = ${seeded.job.id}`,
      );
      expect(Number((row as { secs: string }).secs)).toBeLessThan(6);

      // Tracked under its own generation, it does renew.
      trackOwnedJob(second);
      expect(await renewLeases(env.db, session)).toBe(1);
      untrackOwnedJob(second);
    });
  });

  // ── refund-crash-rolls-back: real signals inside the settlement transaction ───────────

  describe('refund-crash-rolls-back', () => {
    const children = new Set<ChildProcess>();
    afterEach(() => {
      for (const child of children) child.kill('SIGKILL');
      children.clear();
    });

    for (const signal of ['SIGKILL', 'SIGTERM'] as const) {
      for (const point of ['after_status', 'after_ledger', 'after_balance'] as const) {
        it(`${signal} ${point.replace('_', ' ')}, before commit: nothing persists and recovery settles it once`, async () => {
          const seeded = await seedFamily('regular');
          // The test holds the advisory lock the child's gate waits on, so the kill lands
          // after exactly one write and before COMMIT. No sleep decides the interleaving.
          let release: () => void = () => {};
          let held: () => void = () => {};
          const open = new Promise<void>((resolve) => {
            release = resolve;
          });
          const lockTaken = new Promise<void>((resolve) => {
            held = resolve;
          });
          const holder = env.db.transaction(async (tx) => {
            await tx.execute(
              sql`select pg_advisory_xact_lock(hashtext(${`settle-gate:${seeded.job.id}`}))`,
            );
            held();
            await open;
          });
          await lockTaken;

          const child = fork(new URL('../helpers/settle-child.ts', import.meta.url), [], {
            execArgv: ['--import', 'tsx'],
            silent: true,
            env: {
              PATH: process.env.PATH,
              NODE_ENV: 'test',
              SETTLE_TEST_DATABASE_URL: env.databaseUrl,
              SETTLE_TEST_SESSION: randomUUID(),
              SETTLE_TEST_JOB_ID: seeded.job.id,
              SETTLE_TEST_GATE_POINT: point,
            },
          });
          children.add(child);
          const deadline = Date.now() + 30_000;
          for (;;) {
            const waiting = await env.db.execute(
              sql`select 1 from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and wait_event = 'advisory'`,
            );
            if (waiting.length > 0) break;
            if (Date.now() > deadline) throw new Error('child never reached the settlement gate');
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
          const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
          child.kill(signal);
          await exited;
          release();
          await holder;
          // The dead connection's transaction is rolled back by the server.
          const rolledBack = Date.now() + 10_000;
          while (Date.now() < rolledBack) {
            const stuck = await env.db.execute(
              sql`select 1 from pg_stat_activity where datname = current_database() and state like 'idle in transaction%'`,
            );
            if (stuck.length === 0) break;
            await new Promise((resolve) => setTimeout(resolve, 20));
          }

          expect(await ledgerRowCount('regular', seeded.job.id)).toBe(0);
          expect(await balance('regular', seeded)).toBe(START_BALANCE);
          expect(await statusOf(seeded.job.id)).toBe('PREPROCESSING');
          expect(await eventCount(seeded.job.id, 'FAILED')).toBe(0);

          // Recovery: the dead owner's lease expires and the sweeper settles it, once.
          await expireLease(seeded.job.id);
          await env.db
            .update(schema.jobs)
            .set({ startedAt: new Date(Date.now() - 20 * 60_000) })
            .where(eq(schema.jobs.id, seeded.job.id));
          await runSweeper(env.db, redis, redis, log, randomUUID());
          await runSweeper(env.db, redis, redis, log, randomUUID());
          expect(await statusOf(seeded.job.id)).toBe('FAILED');
          expect(await ledgerReasons('regular', seeded.job.id)).toEqual(['JOB_FAIL_REFUND']);
          expect(await balance('regular', seeded)).toBe(START_BALANCE + COST);
        }, 60_000);
      }
    }
  });
});
