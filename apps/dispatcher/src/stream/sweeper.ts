import { type DB, schema } from '@aivastra/db';
import type { Logger } from '@aivastra/logger';
import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { transitionJob } from '../job/state.js';
import { releaseStoreCapSlot } from '../shopify/store-cap.js';

// In-flight jobs whose work started (or, for PREPROCESSING, were created) longer ago than
// this are stuck — a normal try-on completes in ~30-60s, so 15m means the dispatcher died
// mid-flight.
const IN_FLIGHT_SLA_MS = 15 * 60 * 1000;
const IN_FLIGHT_STATES = ['PREPROCESSING', 'GENERATING', 'UPLOADING'];

interface StuckJob {
  id: string;
  userId: string | null;
  merchantId: string | null;
  shopifyStoreId: string | null;
  creditsCharged: number;
  /** job_inputs.params — carries `storeCapKey` for store-billed Shopify jobs. */
  params: unknown;
}

const SELECT_COLS = {
  id: schema.jobs.id,
  userId: schema.jobs.userId,
  merchantId: schema.jobs.merchantId,
  shopifyStoreId: schema.jobs.shopifyStoreId,
  creditsCharged: schema.jobs.creditsCharged,
  params: schema.jobInputs.params,
};

export async function runSweeper(db: DB, redis: Redis, pub: Redis, log: Logger): Promise<void> {
  const now = Date.now();
  // COALESCE(started_at, created_at): started_at is only set at GENERATING, so a job stuck
  // in PREPROCESSING falls back to created_at.
  const inFlightThreshold = new Date(now - IN_FLIGHT_SLA_MS);

  try {
    // Jobs stuck mid-flight after a dispatcher crash. The processor's
    // `status !== 'QUEUED'` guard means these are never reprocessed or refunded on their
    // own, so the sweeper is the only thing that releases the held credit.
    //
    // There is deliberately no equivalent pass for orphaned QUEUED jobs — admission
    // control (assertQueueCapacity in apps/api/src/lib/queue-capacity-config.ts, plus
    // the per-merchant dev-API rate limit) is now the only guard against queue buildup.
    const inFlight = await db
      .select(SELECT_COLS)
      .from(schema.jobs)
      // LEFT, not INNER: a job whose inputs row is missing must still be swept
      // and refunded — losing its cap slot is the lesser failure by far.
      .leftJoin(schema.jobInputs, eq(schema.jobInputs.jobId, schema.jobs.id))
      .where(
        and(
          inArray(schema.jobs.status, IN_FLIGHT_STATES),
          lte(
            sql`coalesce(${schema.jobs.startedAt}, ${schema.jobs.createdAt})`,
            sql`${inFlightThreshold.toISOString()}`,
          ),
        ),
      )
      .limit(50);

    if (inFlight.length === 0) return;
    log.info({ inFlight: inFlight.length }, 'sweeping stuck jobs');

    for (const job of inFlight) await failAndRefund(db, redis, pub, job, 'STUCK_IN_FLIGHT', log);
  } catch (err) {
    log.error({ err }, 'failed to sweep stuck jobs');
  }
}

/**
 * Refund a stuck Shopify job's store, then mark it FAILED.
 *
 * Shopify jobs are billed to `shopify_store_credits` via `shopify_store_id` and
 * carry neither `user_id` nor `merchant_id`, so the user-ledger path below
 * bails at its `if (!userId)` guard and would leave the store paying for a job
 * this sweeper is about to fail. Mirrors `markShopifyFailed` in
 * `job/processor.ts` — same idempotency key (one JOB_FAIL_REFUND row per job)
 * and the same zero-cost guard, which keeps the admin ledger free of phantom
 * zero-delta rows when tryon.creditCost is set to 0.
 *
 * `transitionJob` is passed `shopifyStoreId` (with userId '' — the convention
 * processShopifyJob already uses) so the SSE event reaches
 * `sse:events:store:{id}`. Without it `channelId` falls back to the empty
 * userId and the publish is skipped entirely, leaving the storefront widget to
 * discover the failure only via its slower polling fallback.
 */
async function failAndRefundShopify(
  db: DB,
  redis: Redis,
  pub: Redis,
  job: StuckJob,
  shopifyStoreId: string,
  errorCode: string,
  log: Logger,
): Promise<void> {
  if (job.creditsCharged > 0) {
    await db.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(schema.shopifyCreditLedger)
        .where(
          and(
            eq(schema.shopifyCreditLedger.jobId, job.id),
            eq(schema.shopifyCreditLedger.reason, 'JOB_FAIL_REFUND'),
          ),
        );
      if (existing.length) return;
      await tx
        .update(schema.shopifyStoreCredits)
        .set({ balance: sql`${schema.shopifyStoreCredits.balance} + ${job.creditsCharged}` })
        .where(eq(schema.shopifyStoreCredits.storeId, shopifyStoreId));
      await tx.insert(schema.shopifyCreditLedger).values({
        storeId: shopifyStoreId,
        delta: job.creditsCharged,
        reason: 'JOB_FAIL_REFUND',
        jobId: job.id,
      });
    });
  }

  await transitionJob(db, pub, job.id, '', 'FAILED', { errorCode, shopifyStoreId }, log);
  // Same reasoning as the processor's own failure path: a swept job never ran,
  // so it must stop consuming the merchant's daily cap. Idempotent per jobId,
  // so a sweep racing the processor cannot give the same slot back twice.
  await releaseStoreCapSlot(
    redis,
    (job.params as { storeCapKey?: unknown } | null)?.storeCapKey,
    job.id,
    log,
  );
  log.warn(
    { jobId: job.id, shopifyStoreId, errorCode },
    'stuck shopify job FAILED — store credits refunded',
  );
}

/** Refund the held credit (idempotent, mirrors processor.ts) then mark the job FAILED. */
async function failAndRefund(
  db: DB,
  redis: Redis,
  pub: Redis,
  job: StuckJob,
  errorCode: string,
  log: Logger,
): Promise<void> {
  if (job.shopifyStoreId) {
    await failAndRefundShopify(db, redis, pub, job, job.shopifyStoreId, errorCode, log);
    return;
  }

  await db.transaction(async (tx) => {
    // One credit pool per human. A job's billing owner is its user_id when set;
    // kiosk jobs have user_id = null and are billed to the merchant's owning user.
    let userId = job.userId;
    if (!userId && job.merchantId) {
      const [owner] = await tx
        .select({ userId: schema.merchants.userId })
        .from(schema.merchants)
        .where(eq(schema.merchants.id, job.merchantId))
        .limit(1);
      if (!owner?.userId) {
        // merchantId was set but resolves to no owning user — a genuine
        // data-integrity anomaly, not "this job has nothing to refund".
        // Throw (aborting before transitionJob/XACK below) rather than
        // silently marking the job FAILED with no refund issued.
        // merchants.userId is NOT NULL in the schema, so this should not
        // happen in normal operation.
        throw new Error(
          `failAndRefund: merchant ${job.merchantId} has no owning user (job ${job.id})`,
        );
      }
      userId = owner.userId;
    }
    if (!userId) return; // job genuinely has no billing owner (userId and merchantId both unset) — nothing to refund, pre-existing behavior unchanged

    const existing = await tx
      .select()
      .from(schema.creditLedger)
      .where(eq(schema.creditLedger.jobId, job.id));
    if (existing.some((e) => e.reason === 'JOB_FAIL_REFUND')) return;
    await tx
      .update(schema.userCredits)
      .set({ balance: sql`${schema.userCredits.balance} + ${job.creditsCharged}` })
      .where(eq(schema.userCredits.userId, userId));
    await tx.insert(schema.creditLedger).values({
      userId,
      delta: job.creditsCharged,
      reason: 'JOB_FAIL_REFUND',
      jobId: job.id,
    });
  });

  await transitionJob(db, pub, job.id, job.userId ?? '', 'FAILED', { errorCode }, log);
}
