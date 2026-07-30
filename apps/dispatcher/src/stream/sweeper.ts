import { type DB, schema } from '@aivastra/db';
import type { Logger } from '@aivastra/logger';
import { and, eq, inArray, lte, or, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { transitionJob } from '../job/state.js';

// QUEUED jobs older than this were never picked up by a worker (orphaned at enqueue).
const QUEUED_SLA_MS = 10 * 60 * 1000;
// Catalog-video jobs get a much longer grace period. They ride the jobs:video lane,
// whose in-flight cap is VIDEO_CONCURRENCY (matched to the PixVerse plan), not the GPU
// worker count — and each job takes ~3-5 min. A burst of submissions therefore queues
// legitimately for far longer than a GPU job ever should, and failing those at 10 min
// would refund healthy work that was about to run.
const VIDEO_QUEUED_SLA_MS = 30 * 60 * 1000;
const VIDEO_SOURCE = 'catalog_video';
// In-flight jobs whose work started (or, for PREPROCESSING, were created) longer ago than
// this are stuck — a normal try-on completes in ~30-60s, so 15m means the dispatcher died
// mid-flight. Longer than the QUEUED SLA because these are legitimately mid-processing.
const IN_FLIGHT_SLA_MS = 15 * 60 * 1000;
const IN_FLIGHT_STATES = ['PREPROCESSING', 'GENERATING', 'UPLOADING'];

interface StuckJob {
  id: string;
  userId: string | null;
  merchantId: string | null;
  creditsCharged: number;
}

const SELECT_COLS = {
  id: schema.jobs.id,
  userId: schema.jobs.userId,
  merchantId: schema.jobs.merchantId,
  creditsCharged: schema.jobs.creditsCharged,
};

export async function runSweeper(db: DB, pub: Redis, log: Logger): Promise<void> {
  const now = Date.now();
  const queuedThreshold = new Date(now - QUEUED_SLA_MS);
  const videoQueuedThreshold = new Date(now - VIDEO_QUEUED_SLA_MS);
  // COALESCE(started_at, created_at): started_at is only set at GENERATING, so a job stuck
  // in PREPROCESSING falls back to created_at.
  const inFlightThreshold = new Date(now - IN_FLIGHT_SLA_MS);

  try {
    // Pass 1 — orphaned QUEUED jobs that were never dispatched.
    const orphaned = await db
      .select(SELECT_COLS)
      .from(schema.jobs)
      .where(
        and(
          eq(schema.jobs.status, 'QUEUED'),
          or(
            // jobs.source is nullable, so the negative branch must COALESCE — a bare
            // `source <> 'catalog_video'` evaluates to NULL on legacy rows and would
            // silently stop sweeping them.
            and(
              sql`coalesce(${schema.jobs.source}, '') <> ${VIDEO_SOURCE}`,
              lte(schema.jobs.createdAt, sql`${queuedThreshold.toISOString()}`),
            ),
            and(
              eq(schema.jobs.source, VIDEO_SOURCE),
              lte(schema.jobs.createdAt, sql`${videoQueuedThreshold.toISOString()}`),
            ),
          ),
        ),
      )
      .limit(50);

    // Pass 2 — jobs stuck mid-flight after a dispatcher crash. The processor's
    // `status !== 'QUEUED'` guard means these are never reprocessed or refunded on their
    // own, so the sweeper is the only thing that releases the held credit.
    const inFlight = await db
      .select(SELECT_COLS)
      .from(schema.jobs)
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

    if (orphaned.length === 0 && inFlight.length === 0) return;
    log.info({ orphaned: orphaned.length, inFlight: inFlight.length }, 'sweeping stuck jobs');

    for (const job of orphaned) await failAndRefund(db, pub, job, 'STUCK_IN_QUEUE', log);
    for (const job of inFlight) await failAndRefund(db, pub, job, 'STUCK_IN_FLIGHT', log);
  } catch (err) {
    log.error({ err }, 'failed to sweep stuck jobs');
  }
}

/** Refund the held credit (idempotent, mirrors processor.ts) then mark the job FAILED. */
async function failAndRefund(
  db: DB,
  pub: Redis,
  job: StuckJob,
  errorCode: string,
  log: Logger,
): Promise<void> {
  await db.transaction(async (tx) => {
    if (job.merchantId) {
      const existing = await tx
        .select()
        .from(schema.merchantCreditLedger)
        .where(
          and(
            eq(schema.merchantCreditLedger.jobId, job.id),
            eq(schema.merchantCreditLedger.reason, 'JOB_FAIL_REFUND'),
          ),
        );
      if (existing.length) return;
      await tx
        .update(schema.merchantCredits)
        .set({ balance: sql`${schema.merchantCredits.balance} + ${job.creditsCharged}` })
        .where(eq(schema.merchantCredits.merchantId, job.merchantId));
      await tx.insert(schema.merchantCreditLedger).values({
        merchantId: job.merchantId,
        delta: job.creditsCharged,
        reason: 'JOB_FAIL_REFUND',
        jobId: job.id,
      });
    } else if (job.userId) {
      const existing = await tx
        .select()
        .from(schema.creditLedger)
        .where(eq(schema.creditLedger.jobId, job.id));
      if (existing.some((e) => e.reason === 'JOB_FAIL_REFUND')) return;
      await tx
        .update(schema.userCredits)
        .set({ balance: sql`${schema.userCredits.balance} + ${job.creditsCharged}` })
        .where(eq(schema.userCredits.userId, job.userId));
      await tx.insert(schema.creditLedger).values({
        userId: job.userId,
        delta: job.creditsCharged,
        reason: 'JOB_FAIL_REFUND',
        jobId: job.id,
      });
    }
  });

  await transitionJob(db, pub, job.id, job.userId ?? '', 'FAILED', { errorCode }, log);
}
