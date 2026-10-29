import { type DB, type DbTransaction, schema } from '@aivastra/db';
import type { Logger } from '@aivastra/logger';
import { dispatcherSettlementsTotal, jobE2eDuration } from '@aivastra/observability';
import { JOB_REFUND_REASONS } from '@aivastra/types';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { Redis } from 'ioredis';
import { checkAndCleanupArchiveForJob } from '../workflow/drain-cleanup.js';
import {
  assertOwnerInTransaction,
  isTerminalStatus,
  noteOwnershipLost,
  OwnershipLostError,
  type OwnerToken,
  retireOwnership,
  takeoverInTransaction,
} from './ownership.js';
import { recordAttemptOutcome } from './submission.js';

export interface CompletedOutput {
  resultKey: string;
  thumbnailKey?: string;
  assetKind?: 'ORIGINAL' | 'WATERMARKED';
  watermarkVersion?: number | null;
  shopifyStoreId?: string;
  /** The caller already wrote job_outputs. */
  skipOutputInsert?: boolean;
}

export type SettleOutcome =
  | { kind: 'completed'; output: CompletedOutput }
  | { kind: 'failed'; errorCode: string }
  | { kind: 'cancelled'; errorCode?: string };

export type SettleAuthority =
  | { owner: OwnerToken }
  /** The sweeper takes a fresh generation inside the settlement transaction itself. */
  | { takeover: { jobId: string; session: string } }
  /**
   * Lanes with no control row (the PixVerse video lane): no ownership to check or retire, but
   * the same terminal fence and the same all-reasons refund check.
   */
  | { unowned: { jobId: string } };

const authorityJobId = (a: SettleAuthority) =>
  'owner' in a ? a.owner.jobId : 'takeover' in a ? a.takeover.jobId : a.unowned.jobId;

export type PayerKind = 'user' | 'merchant_user' | 'store' | 'none';

export interface SettledJob {
  userId: string | null;
  merchantId: string | null;
  shopifyStoreId: string | null;
  createdAt: Date;
  source: string | null;
}

export type SettleResult =
  | {
      kind: 'settled';
      status: 'COMPLETED' | 'FAILED' | 'CANCELLED';
      refunded: number;
      payer: PayerKind;
      job: SettledJob;
      /** What the terminal job_events row and the SSE payload carry. */
      eventPayload: Record<string, unknown>;
      generation: number;
    }
  | { kind: 'already_terminal'; status: string }
  | { kind: 'lost' };

/**
 * Test-only seam for the process-kill tests: when SETTLE_TEST_GATE_POINT names a point, the
 * transaction parks on a transaction-scoped advisory lock the test holds, so a real
 * SIGKILL/SIGTERM can land after one specific write and before COMMIT.
 *
 * Read once at module load, and only honoured under NODE_ENV=test: a production container
 * runs NODE_ENV=production, so the variable is ignored even if it were ever set there. With
 * no gate configured the check is a constant comparison: no extra query, no advisory lock.
 * It is deliberately absent from every compose file and env example.
 */
const SETTLE_TEST_GATE_POINT =
  process.env.NODE_ENV === 'test' ? process.env.SETTLE_TEST_GATE_POINT : undefined;

async function testGate(tx: DbTransaction, point: string, jobId: string): Promise<void> {
  if (SETTLE_TEST_GATE_POINT !== point) return;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`settle-gate:${jobId}`}))`);
}

const STATUS_FOR = { completed: 'COMPLETED', failed: 'FAILED', cancelled: 'CANCELLED' } as const;

/**
 * Settles every paid-Comfy terminal outcome — completion, failure, cancel and the stuck-job
 * sweeper — in ONE transaction: ownership check, status, terminal event, output row, refund,
 * attempt record and lease retirement commit together or not at all.
 *
 * Lock order is B1's: `jobs` FOR UPDATE, then `dispatcher_job_control`. A job that is already
 * terminal is left exactly as it is (no status, event, output or ledger write): that is what
 * keeps an admin- or user-cancelled job CANCELLED and stops a second refund for it. The
 * refund is skipped when ANY refund reason already exists for the job, because the API's
 * cancel paths write their own reasons and the (job_id, reason) unique index cannot see
 * across reasons; that index stays as the backstop only.
 *
 * Post-commit effects (SSE, webhooks, cap release, metrics) belong to the caller and must run
 * only for `settled`.
 */
export async function settleComfyJob(
  db: DB,
  authority: SettleAuthority,
  outcome: SettleOutcome,
  log: Logger,
): Promise<SettleResult> {
  const startedAt = performance.now();
  const jobId = authorityJobId(authority);
  const requested = STATUS_FOR[outcome.kind];

  const result = await db.transaction((tx) => settleInTransaction(tx, authority, outcome));

  const settled = result.kind === 'settled' ? result : undefined;
  dispatcherSettlementsTotal.inc({ result: result.kind, status: requested });
  log.info(
    {
      stage: 'settle',
      durationMs: performance.now() - startedAt,
      result: result.kind,
      status: settled?.status ?? ('status' in result ? result.status : requested),
      payer: settled?.payer,
      refunded: settled?.refunded,
      generation: settled?.generation,
      jobId,
    },
    'job stage timing',
  );
  // So the double refunds this fence prevents can be counted in production.
  if (result.kind === 'already_terminal' && outcome.kind !== 'completed') {
    log.warn(
      { jobId, requested, existing: result.status },
      'settlement skipped: job already terminal, no second refund issued',
    );
  }
  return result;
}

async function settleInTransaction(
  tx: DbTransaction,
  authority: SettleAuthority,
  outcome: SettleOutcome,
): Promise<SettleResult> {
  const jobId = authorityJobId(authority);
  const status = STATUS_FOR[outcome.kind];

  const [job] = await tx.select().from(schema.jobs).where(eq(schema.jobs.id, jobId)).for('update');
  if (!job) return { kind: 'lost' };

  let owner: OwnerToken | undefined;
  if ('unowned' in authority) {
    owner = undefined;
  } else if ('owner' in authority) {
    try {
      await assertOwnerInTransaction(tx, authority.owner, `settle:${status}`);
    } catch (err) {
      // Nothing has been written yet, so leaving the transaction here changes no row.
      if (err instanceof OwnershipLostError) return { kind: 'lost' };
      throw err;
    }
    owner = authority.owner;
  } else {
    const taken = await takeoverInTransaction(tx, jobId, authority.takeover.session);
    if (taken.kind === 'Terminal') return { kind: 'already_terminal', status: job.status };
    // A live owner (or anything else that is not ours to settle) is not the sweeper's job.
    if (taken.kind !== 'Acquired') return { kind: 'lost' };
    owner = taken.owner;
  }

  if (isTerminalStatus(job.status)) {
    if (owner) await retireOwnership(tx, owner);
    return { kind: 'already_terminal', status: job.status };
  }

  const eventPayload: Record<string, unknown> =
    outcome.kind === 'completed'
      ? { ...outcome.output }
      : outcome.kind === 'failed'
        ? {
            errorCode: outcome.errorCode,
            ...(job.shopifyStoreId ? { shopifyStoreId: job.shopifyStoreId } : {}),
          }
        : outcome.errorCode
          ? { errorCode: outcome.errorCode }
          : {};

  await tx
    .update(schema.jobs)
    .set({
      status,
      completedAt: new Date(),
      ...(outcome.kind === 'failed' ? { errorCode: outcome.errorCode } : {}),
      // A cancel without a code (a user/dispatcher cancel) clears any stale one.
      ...(outcome.kind === 'cancelled' ? { errorCode: outcome.errorCode ?? null } : {}),
    })
    .where(eq(schema.jobs.id, jobId));

  if (outcome.kind === 'completed' && !outcome.output.skipOutputInsert) {
    const row = {
      resultKey: outcome.output.resultKey,
      thumbnailKey: outcome.output.thumbnailKey ?? null,
      assetKind: outcome.output.assetKind ?? 'ORIGINAL',
      watermarkVersion: outcome.output.watermarkVersion ?? null,
    };
    await tx
      .insert(schema.jobOutputs)
      .values({ jobId, ...row })
      .onConflictDoUpdate({ target: schema.jobOutputs.jobId, set: row });
  }
  await tx.insert(schema.jobEvents).values({ jobId, eventType: status, payload: eventPayload });
  await testGate(tx, 'after_status', jobId);

  const refund =
    outcome.kind === 'completed'
      ? { refunded: 0, payer: 'none' as PayerKind }
      : await refundInTransaction(
          tx,
          job,
          outcome.kind === 'cancelled' ? 'JOB_CANCEL_REFUND' : 'JOB_FAIL_REFUND',
        );

  // The ownerless lane has no control row, so it must not even read one: no attempt record,
  // no lease to retire. (A paid job with no active-attempt pointer simply matches no row.)
  if (owner) {
    await recordAttemptOutcome(tx, jobId, status);
    await retireOwnership(tx, owner);
  }

  return {
    kind: 'settled',
    status,
    refunded: refund.refunded,
    payer: refund.payer,
    job: {
      userId: job.userId,
      merchantId: job.merchantId,
      shopifyStoreId: job.shopifyStoreId,
      createdAt: job.createdAt,
      source: job.source,
    },
    eventPayload,
    generation: owner?.generation ?? 0,
  };
}

/**
 * The one place the payer is decided. Debits at creation are:
 *  - Shopify store jobs: the store (`atomicDeductStore`)
 *  - merchant/widget jobs: `merchants.user_id` (`atomicMerchantDeduct`)
 *  - everything else, merchant-catalog and dev-API jobs included: `jobs.user_id`
 * so the refund goes to the same account.
 *
 * For widget jobs `jobs.user_id` is the same account only because widget creation stores
 * `merchantUserId` on the job row; the merchant lookup is authoritative and a test asserts
 * the two agree.
 */
async function refundInTransaction(
  tx: DbTransaction,
  job: typeof schema.jobs.$inferSelect,
  reason: 'JOB_FAIL_REFUND' | 'JOB_CANCEL_REFUND',
): Promise<{ refunded: number; payer: PayerKind }> {
  const amount = job.creditsCharged;

  if (job.shopifyStoreId) {
    // Zero cost writes no row at all: a phantom zero-delta row would pollute the admin
    // ledger on every failed job billed at tryon.creditCost = 0.
    if (amount <= 0) return { refunded: 0, payer: 'store' };
    const [prior] = await tx
      .select({ id: schema.shopifyCreditLedger.id })
      .from(schema.shopifyCreditLedger)
      .where(
        and(
          eq(schema.shopifyCreditLedger.jobId, job.id),
          inArray(schema.shopifyCreditLedger.reason, [...JOB_REFUND_REASONS]),
        ),
      )
      .limit(1);
    if (prior) return { refunded: 0, payer: 'store' };
    // Ledger first: the row is the idempotency record, so the balance moves only when it
    // was actually inserted.
    const inserted = await tx
      .insert(schema.shopifyCreditLedger)
      .values({ storeId: job.shopifyStoreId, delta: amount, reason, jobId: job.id })
      .onConflictDoNothing()
      .returning({ id: schema.shopifyCreditLedger.id });
    if (!inserted.length) return { refunded: 0, payer: 'store' };
    await testGate(tx, 'after_ledger', job.id);
    await tx
      .update(schema.shopifyStoreCredits)
      .set({ balance: sqlAdd(schema.shopifyStoreCredits.balance, amount), updatedAt: new Date() })
      .where(eq(schema.shopifyStoreCredits.storeId, job.shopifyStoreId));
    await testGate(tx, 'after_balance', job.id);
    return { refunded: amount, payer: 'store' };
  }

  let userId = job.userId;
  let payer: PayerKind = 'user';
  if (job.merchantId) {
    const [merchant] = await tx
      .select({ userId: schema.merchants.userId })
      .from(schema.merchants)
      .where(eq(schema.merchants.id, job.merchantId))
      .limit(1);
    if (!merchant?.userId) {
      // Throwing rolls the whole settlement back: a job that silently loses its refund is
      // worse than one left pending for redelivery. merchants.user_id is NOT NULL, so this
      // only fires on a genuine data-integrity anomaly.
      throw new Error(`settle: merchant ${job.merchantId} has no owning user (job ${job.id})`);
    }
    userId = merchant.userId;
    payer = 'merchant_user';
  }
  // No billing owner (neither user nor merchant): nothing was debited, nothing to refund.
  if (!userId) return { refunded: 0, payer: 'none' };
  if (amount <= 0) return { refunded: 0, payer };

  const [prior] = await tx
    .select({ id: schema.creditLedger.id })
    .from(schema.creditLedger)
    .where(
      and(
        eq(schema.creditLedger.jobId, job.id),
        inArray(schema.creditLedger.reason, [...JOB_REFUND_REASONS]),
      ),
    )
    .limit(1);
  if (prior) return { refunded: 0, payer };
  const inserted = await tx
    .insert(schema.creditLedger)
    .values({ userId, delta: amount, reason, jobId: job.id })
    .onConflictDoNothing()
    .returning({ id: schema.creditLedger.id });
  if (!inserted.length) return { refunded: 0, payer };
  await testGate(tx, 'after_ledger', job.id);
  await tx
    .update(schema.userCredits)
    .set({ balance: sqlAdd(schema.userCredits.balance, amount), updatedAt: new Date() })
    .where(eq(schema.userCredits.userId, userId));
  await testGate(tx, 'after_balance', job.id);
  return { refunded: amount, payer };
}

function sqlAdd(column: PgColumn, amount: number) {
  return sql`${column} + ${amount}`;
}

export interface SettleNotify {
  /** Passed as before: '' for store- and widget-billed jobs, which have no SSE user channel. */
  userId: string;
  /** Store-billed jobs publish to `sse:events:store:{id}`. */
  shopifyStoreId?: string;
}

/**
 * Settles, then runs the post-commit effects every terminal path shares (duration metric,
 * archive cleanup, SSE) when — and only when — this call settled the job.
 *
 * With an owner, a lost settlement stops the whole handler the way every other fenced write
 * does (OwnershipLostError, no ACK); a takeover that did not acquire is simply skipped.
 */
export async function settleAndPublish(
  ctx: { db: DB; pub: Redis; log: Logger },
  authority: SettleAuthority,
  outcome: SettleOutcome,
  notify: SettleNotify,
): Promise<SettleResult> {
  const result = await settleComfyJob(ctx.db, authority, outcome, ctx.log);
  if (result.kind === 'lost' && 'owner' in authority) {
    noteOwnershipLost(ctx.log, authority.owner, `settle:${STATUS_FOR[outcome.kind]}`);
    throw new OwnershipLostError(
      authority.owner.jobId,
      `settle:${STATUS_FOR[outcome.kind]}`,
      authority.owner,
    );
  }
  if (result.kind !== 'settled') return result;

  const jobId = authorityJobId(authority);
  jobE2eDuration.observe(
    { outcome: result.status.toLowerCase(), job_type: result.job.source ?? 'unknown' },
    (Date.now() - result.job.createdAt.getTime()) / 1000,
  );
  await checkAndCleanupArchiveForJob(ctx.db, jobId, ctx.log);

  const channelId = notify.shopifyStoreId ? `store:${notify.shopifyStoreId}` : notify.userId;
  const ssePayload = JSON.stringify({
    jobId,
    userId: notify.userId,
    type: 'STATUS',
    status: result.status,
    ...result.eventPayload,
  });
  const publishes = [ctx.pub.publish('sse:events:admin', ssePayload)];
  if (channelId) publishes.push(ctx.pub.publish(`sse:events:${channelId}`, ssePayload));
  await Promise.all(publishes);
  ctx.log.info({ jobId, userId: notify.userId, channelId, status: result.status }, 'job settled');
  return result;
}
