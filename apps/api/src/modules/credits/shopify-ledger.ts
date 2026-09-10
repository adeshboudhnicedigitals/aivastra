import type { DB } from '@aivastra/db';
import { schema } from '@aivastra/db';
import { creditsDeductedTotal, creditsRefundedTotal } from '@aivastra/observability';
import { and, eq, gte, notInArray, sql } from 'drizzle-orm';
import { AppError } from '../../lib/errors.js';

/** Store-scoped equivalent of ledger.ts's atomicDeduct — bills a Shopify store's own balance instead of any user's. */
export async function atomicDeductStore(db: DB, storeId: string, amount: number, jobId: string) {
  const balance = await db.transaction(async (tx) => {
    const res = await tx
      .update(schema.shopifyStoreCredits)
      .set({
        balance: sql`${schema.shopifyStoreCredits.balance} - ${amount}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.shopifyStoreCredits.storeId, storeId),
          gte(schema.shopifyStoreCredits.balance, amount),
        ),
      )
      .returning({ balance: schema.shopifyStoreCredits.balance });
    if (!res.length) throw new AppError('INSUFFICIENT_CREDITS', 402, 'insufficient credits');
    await tx
      .insert(schema.shopifyCreditLedger)
      .values({ storeId, delta: -amount, reason: 'JOB_DISPATCH', jobId });
    return res[0]?.balance;
  });
  creditsDeductedTotal.inc(amount);
  return balance;
}

/** Store-scoped equivalent of ledger.ts's refundAndMarkFailed — see that function's docstring for why the refund and FAILED transition share one transaction guarded on status='QUEUED'. */
export async function refundStoreAndMarkFailed(
  db: DB,
  storeId: string,
  amount: number,
  jobId: string,
  refundReason: string,
  jobErrorCode: string,
): Promise<{ compensated: boolean }> {
  const result = await db.transaction(async (tx) => {
    const claimed = await tx
      .update(schema.jobs)
      .set({ status: 'FAILED', errorCode: jobErrorCode })
      .where(and(eq(schema.jobs.id, jobId), eq(schema.jobs.status, 'QUEUED')))
      .returning({ id: schema.jobs.id });
    if (!claimed.length) return { compensated: false, refunded: false };

    const inserted = await tx
      .insert(schema.shopifyCreditLedger)
      .values({ storeId, delta: amount, reason: refundReason, jobId })
      .onConflictDoNothing()
      .returning({ id: schema.shopifyCreditLedger.id });
    if (inserted.length) {
      await tx
        .update(schema.shopifyStoreCredits)
        .set({
          balance: sql`${schema.shopifyStoreCredits.balance} + ${amount}`,
          updatedAt: new Date(),
        })
        .where(eq(schema.shopifyStoreCredits.storeId, storeId));
    }
    return { compensated: true, refunded: inserted.length > 0 };
  });
  if (result.refunded) creditsRefundedTotal.inc(amount);
  return { compensated: result.compensated };
}

// A job in one of these states is finished; an admin cancel must not touch it.
// COMPLETED means the shopper got their image, and FAILED/CANCELLED means some
// other path already ran its own compensation.
const TERMINAL_JOB_STATUSES = ['COMPLETED', 'FAILED', 'CANCELLED'];

/**
 * Store-scoped admin cancellation — flip the job to CANCELLED and return its
 * credits to the store, atomically.
 *
 * Mirrors `refundStoreAndMarkFailed` with two deliberate differences. The
 * status guard excludes the terminal states rather than requiring `QUEUED`:
 * admin cancel legitimately reaches PREPROCESSING/GENERATING/UPLOADING jobs,
 * which the enqueue-failure compensation never does. And claiming that
 * transition first is what makes a cancel that races the dispatcher's own
 * terminal transition a no-op rather than a double refund — by then
 * `markShopifyFailed` has already paid the store back, or the shopper has
 * their image and the credit was genuinely spent.
 *
 * Idempotent twice over: the status guard filters a replay (the row is
 * CANCELLED by then), and the `(job_id, reason)` partial unique index on
 * `shopify_credit_ledger` makes the ledger insert at-most-once regardless.
 */
export async function refundStoreAndMarkCancelled(
  db: DB,
  storeId: string,
  amount: number,
  jobId: string,
  refundReason: string,
  jobErrorCode: string,
): Promise<{ compensated: boolean }> {
  const result = await db.transaction(async (tx) => {
    const claimed = await tx
      .update(schema.jobs)
      .set({ status: 'CANCELLED', errorCode: jobErrorCode })
      .where(and(eq(schema.jobs.id, jobId), notInArray(schema.jobs.status, TERMINAL_JOB_STATUSES)))
      .returning({ id: schema.jobs.id });
    if (!claimed.length) return { compensated: false, refunded: false };

    // tryon.creditCost is admin-tunable and can legitimately be 0 — skip the
    // ledger write rather than record a zero-delta row, matching the guard in
    // the dispatcher's markShopifyFailed.
    if (amount <= 0) return { compensated: true, refunded: false };

    const inserted = await tx
      .insert(schema.shopifyCreditLedger)
      .values({ storeId, delta: amount, reason: refundReason, jobId })
      .onConflictDoNothing()
      .returning({ id: schema.shopifyCreditLedger.id });
    if (inserted.length) {
      await tx
        .update(schema.shopifyStoreCredits)
        .set({
          balance: sql`${schema.shopifyStoreCredits.balance} + ${amount}`,
          updatedAt: new Date(),
        })
        .where(eq(schema.shopifyStoreCredits.storeId, storeId));
    }
    return { compensated: true, refunded: inserted.length > 0 };
  });
  if (result.refunded) creditsRefundedTotal.inc(amount);
  return { compensated: result.compensated };
}

/** Store-scoped equivalent of ledger.ts's adminGrant idiom, but idempotent via externalRef (mirrors billing.ts's trial/subscription grants) rather than always-apply. */
export async function grantStore(
  db: DB,
  storeId: string,
  amount: number,
  reason: string,
  externalRef?: string,
): Promise<{ granted: boolean }> {
  const granted = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(schema.shopifyCreditLedger)
      .values({ storeId, delta: amount, reason, externalRef })
      .onConflictDoNothing()
      .returning({ id: schema.shopifyCreditLedger.id });
    if (!inserted.length) return false;
    await tx
      .insert(schema.shopifyStoreCredits)
      .values({ storeId, balance: amount })
      .onConflictDoUpdate({
        target: schema.shopifyStoreCredits.storeId,
        set: {
          balance: sql`${schema.shopifyStoreCredits.balance} + ${amount}`,
          updatedAt: new Date(),
        },
      });
    return true;
  });
  return { granted };
}
