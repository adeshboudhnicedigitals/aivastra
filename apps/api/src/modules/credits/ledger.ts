import type { DB, DbTransaction } from '@aivastra/db';
import { schema } from '@aivastra/db';
import { creditsDeductedTotal, creditsRefundedTotal } from '@aivastra/observability';
import { JOB_REFUND_REASONS } from '@aivastra/types';
import { and, eq, gte, inArray, notInArray, sql } from 'drizzle-orm';
import { AppError } from '../../lib/errors.js';
import { getActiveUnlimitedPlan } from './unlimited-plan.js';

export async function atomicDeduct(db: DB, userId: string, amount: number, jobId: string) {
  const { balance, deducted } = await db.transaction(async (tx) => {
    // A user on an active unlimited plan spends nothing — but a zero-delta
    // ledger row is still written so "every job writes a ledger row" stays an
    // invariant and admins can audit unlimited-plan usage per job.
    const activePlan = await getActiveUnlimitedPlan(tx, userId);
    if (activePlan) {
      await tx
        .insert(schema.creditLedger)
        .values({ userId, delta: 0, reason: 'UNLIMITED_PLAN_USAGE', jobId });
      const [row] = await tx
        .select({ balance: schema.userCredits.balance })
        .from(schema.userCredits)
        .where(eq(schema.userCredits.userId, userId));
      return { balance: row?.balance ?? 0, deducted: false };
    }

    const res = await tx
      .update(schema.userCredits)
      .set({ balance: sql`${schema.userCredits.balance} - ${amount}`, updatedAt: new Date() })
      .where(and(eq(schema.userCredits.userId, userId), gte(schema.userCredits.balance, amount)))
      .returning({ balance: schema.userCredits.balance });
    if (!res.length) throw new AppError('INSUFFICIENT_CREDITS', 402, 'insufficient credits');
    await tx
      .insert(schema.creditLedger)
      .values({ userId, delta: -amount, reason: 'JOB_DISPATCH', jobId });
    return { balance: res[0]?.balance, deducted: true };
  });
  if (deducted) creditsDeductedTotal.inc(amount);
  return balance;
}

/**
 * Writes the refund ledger row and bumps the balance inside the caller's
 * transaction. The ledger insert goes first: the unique index on (job_id, reason)
 * WHERE job_id IS NOT NULL is what guarantees at-most-once without a racy SELECT.
 * Returns false when this (job, reason) was already refunded. Callers own the
 * metric (`creditsRefundedTotal`) — increment it only after the transaction commits.
 */
export async function applyRefundTx(
  tx: DbTransaction,
  userId: string,
  amount: number,
  jobId: string,
  reason: string,
): Promise<boolean> {
  const inserted = await tx
    .insert(schema.creditLedger)
    .values({ userId, delta: amount, reason, jobId })
    .onConflictDoNothing()
    .returning({ id: schema.creditLedger.id });
  if (!inserted.length) return false;
  await tx
    .update(schema.userCredits)
    .set({ balance: sql`${schema.userCredits.balance} + ${amount}`, updatedAt: new Date() })
    .where(eq(schema.userCredits.userId, userId));
  return true;
}

// A job in one of these states is finished: a cancel must not rewrite it or refund it.
const TERMINAL_JOB_STATUSES = ['COMPLETED', 'FAILED', 'CANCELLED'];

/**
 * Cancel a job and return its credits in ONE transaction, for cancels that can reach a job
 * the dispatcher is still running (admin cancel of an in-flight job, widget cancel).
 *
 * The status claim is a conditional UPDATE, so a cancel that races the dispatcher's own
 * terminal write is a no-op rather than a refund of a job that completed (the customer
 * keeps the image AND gets the credits) or a rewrite of a FAILED job. The claim also locks
 * the jobs row, which is the lock the dispatcher's settlement takes first, so either side
 * can win once. The refund is skipped when ANY refund reason already exists for the job.
 * `userId` null (a job with no billing owner) claims the status and refunds nothing.
 */
export async function cancelJobAndRefund(
  db: DB,
  p: {
    jobId: string;
    userId: string | null;
    amount: number;
    refundReason: string;
    errorCode?: string;
  },
): Promise<{ claimed: boolean }> {
  const result = await db.transaction(async (tx) => {
    const claimed = await tx
      .update(schema.jobs)
      .set({ status: 'CANCELLED', ...(p.errorCode ? { errorCode: p.errorCode } : {}) })
      .where(
        and(eq(schema.jobs.id, p.jobId), notInArray(schema.jobs.status, TERMINAL_JOB_STATUSES)),
      )
      .returning({ id: schema.jobs.id });
    if (!claimed.length) return { claimed: false, refunded: false };
    // Zero cost writes no ledger row, matching the dispatcher's settlement.
    if (!p.userId || p.amount <= 0) return { claimed: true, refunded: false };
    const [prior] = await tx
      .select({ id: schema.creditLedger.id })
      .from(schema.creditLedger)
      .where(
        and(
          eq(schema.creditLedger.jobId, p.jobId),
          inArray(schema.creditLedger.reason, [...JOB_REFUND_REASONS]),
        ),
      )
      .limit(1);
    if (prior) return { claimed: true, refunded: false };
    const refunded = await applyRefundTx(tx, p.userId, p.amount, p.jobId, p.refundReason);
    return { claimed: true, refunded };
  });
  if (result.refunded) creditsRefundedTotal.inc(p.amount);
  return { claimed: result.claimed };
}

export async function refund(
  db: DB,
  userId: string,
  amount: number,
  jobId: string,
  reason = 'REFUND',
) {
  const refunded = await db.transaction(async (tx) => {
    if (reason === 'REFUND_ADMIN_CANCEL') {
      // Share the dispatcher terminal lock so either refund reason can win once.
      await tx
        .select({ id: schema.jobs.id })
        .from(schema.jobs)
        .where(eq(schema.jobs.id, jobId))
        .for('update');
      const [priorRefund] = await tx
        .select({ id: schema.creditLedger.id })
        .from(schema.creditLedger)
        .where(
          and(
            eq(schema.creditLedger.jobId, jobId),
            inArray(schema.creditLedger.reason, [...JOB_REFUND_REASONS]),
          ),
        )
        .limit(1);
      if (priorRefund) return false;
    }
    return applyRefundTx(tx, userId, amount, jobId, reason);
  });
  if (refunded) creditsRefundedTotal.inc(amount);
}

/**
 * Refund and terminally fail a job in one atomic, idempotent transaction.
 *
 * Previously the refund (its own transaction) and the job's `FAILED`
 * transition (a separate update) were two independent round trips. A crash
 * between them left a partially-compensated job: refunded but still
 * `QUEUED`, or `FAILED` but never refunded. Wrapping both in one transaction
 * makes the pair all-or-nothing.
 *
 * Guarded on `status = 'QUEUED'` — the status a job holds between its insert
 * transaction committing and the Redis XADD succeeding, which is the only
 * window this compensation is for. XADD is ambiguous on a timeout: the message
 * may well have landed server-side while the client's ack was lost, in which
 * case the dispatcher is already running the job. Without the guard, the
 * caller's error path would overwrite a `RUNNING`/`COMPLETED` job to `FAILED`
 * and refund a generation the shopper actually received — they keep the image
 * AND get their credits back. Losing the compensation in that case is correct:
 * the job really did run, so the credit really was spent.
 *
 * Idempotent: the ledger insert is additionally guarded by the same
 * (job_id, reason)-scoped unique index `refund()` relies on, so a replay for a
 * job already compensated (now `FAILED`, so also filtered by the status guard)
 * is a no-op either way.
 *
 * Returns whether the compensation was applied; `false` means the job had
 * already moved past `QUEUED` and was deliberately left alone.
 */
export async function refundAndMarkFailed(
  db: DB,
  userId: string,
  amount: number,
  jobId: string,
  refundReason: string,
  jobErrorCode: string,
): Promise<{ compensated: boolean }> {
  const result = await db.transaction(async (tx) => {
    // Claim the transition first: if this matches nothing, the job is no
    // longer compensable and the refund must not happen either.
    const claimed = await tx
      .update(schema.jobs)
      .set({ status: 'FAILED', errorCode: jobErrorCode })
      .where(and(eq(schema.jobs.id, jobId), eq(schema.jobs.status, 'QUEUED')))
      .returning({ id: schema.jobs.id });
    if (!claimed.length) return { compensated: false, refunded: false };

    // Unique index on (job_id, reason) WHERE job_id IS NOT NULL guarantees
    // at-most-once without a racy SELECT check.
    const inserted = await tx
      .insert(schema.creditLedger)
      .values({ userId, delta: amount, reason: refundReason, jobId })
      .onConflictDoNothing()
      .returning({ id: schema.creditLedger.id });
    if (inserted.length) {
      await tx
        .update(schema.userCredits)
        .set({ balance: sql`${schema.userCredits.balance} + ${amount}`, updatedAt: new Date() })
        .where(eq(schema.userCredits.userId, userId));
    }
    return { compensated: true, refunded: inserted.length > 0 };
  });
  if (result.refunded) creditsRefundedTotal.inc(amount);
  return { compensated: result.compensated };
}

export async function adminGrant(
  db: DB,
  userId: string,
  amount: number,
  reason: string,
  adminId: string,
) {
  await db.transaction(async (tx) => {
    await tx
      .insert(schema.userCredits)
      .values({ userId, balance: amount })
      .onConflictDoUpdate({
        target: schema.userCredits.userId,
        set: { balance: sql`${schema.userCredits.balance} + ${amount}`, updatedAt: new Date() },
      });
    await tx.insert(schema.creditLedger).values({ userId, delta: amount, reason, adminId });
  });
}
