import { type DB, schema } from '@aivastra/db';
import type { Logger } from '@aivastra/logger';
import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { processSession } from '../job/ownership.js';
import { settleAndPublish } from '../job/settlement.js';
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
  /** True while a dispatcher holds an unretired, unexpired lease on the job. */
  liveOwner: boolean;
}

const SELECT_COLS = {
  id: schema.jobs.id,
  userId: schema.jobs.userId,
  merchantId: schema.jobs.merchantId,
  shopifyStoreId: schema.jobs.shopifyStoreId,
  creditsCharged: schema.jobs.creditsCharged,
  params: schema.jobInputs.params,
  // Postgres time, like every other lease comparison. A job with no control row
  // (in flight before ownership existed) is not live.
  liveOwner: sql<boolean>`coalesce(not ${schema.dispatcherJobControl.ownerRetired}
    and ${schema.dispatcherJobControl.leaseUntil} > clock_timestamp(), false)`,
};

export async function runSweeper(
  db: DB,
  redis: Redis,
  pub: Redis,
  log: Logger,
  session: string = processSession,
): Promise<void> {
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
      .leftJoin(schema.dispatcherJobControl, eq(schema.dispatcherJobControl.jobId, schema.jobs.id))
      .where(
        and(
          inArray(schema.jobs.status, IN_FLIGHT_STATES),
          lte(
            sql`coalesce(${schema.jobs.startedAt}, ${schema.jobs.createdAt})`,
            sql`${inFlightThreshold.toISOString()}`,
          ),
        ),
      )
      // Live-leased jobs sort last so they cannot crowd the limit out of the dead ones.
      .orderBy(SELECT_COLS.liveOwner)
      .limit(50);

    if (inFlight.length === 0) return;
    log.info({ inFlight: inFlight.length }, 'sweeping stuck jobs');

    for (const job of inFlight) {
      if (job.liveOwner) {
        log.info({ jobId: job.id }, 'sweeper skipping job with a live ownership lease');
        continue;
      }
      await failAndRefund(db, redis, pub, job, 'STUCK_IN_FLIGHT', log, session);
    }
  } catch (err) {
    log.error({ err }, 'failed to sweep stuck jobs');
  }
}

/**
 * Fail a stuck job and return its charge, in one fenced settlement.
 *
 * The sweeper never uses a dead owner's token: settleComfyJob takes a fresh generation inside
 * its own transaction, so a job whose owner is alive (or already finished) is neither failed
 * nor refunded. The payer is resolved there, from the job's own billing fields: a Shopify
 * store job refunds its store, a merchant job its owning user, anything else jobs.user_id.
 */
async function failAndRefund(
  db: DB,
  redis: Redis,
  pub: Redis,
  job: StuckJob,
  errorCode: string,
  log: Logger,
  session: string,
): Promise<void> {
  const settled = await settleAndPublish(
    { db, pub, log },
    { takeover: { jobId: job.id, session } },
    { kind: 'failed', errorCode },
    // A store job has no user channel; its SSE goes to the store's own (userId '' + store id),
    // otherwise the publish is skipped and the storefront widget finds out only by polling.
    job.shopifyStoreId
      ? { userId: '', shopifyStoreId: job.shopifyStoreId }
      : { userId: job.userId ?? '' },
  );
  if (settled.kind !== 'settled') {
    log.info({ jobId: job.id }, 'sweeper skipping job: owned or already finished');
    return;
  }
  if (job.shopifyStoreId) {
    // Same reasoning as the processor's own failure path: a swept job never ran, so it must
    // stop consuming the merchant's daily cap. Idempotent per jobId, so a sweep racing the
    // processor cannot give the same slot back twice.
    await releaseStoreCapSlot(
      redis,
      (job.params as { storeCapKey?: unknown } | null)?.storeCapKey,
      job.id,
      log,
    );
    log.warn(
      { jobId: job.id, shopifyStoreId: job.shopifyStoreId, errorCode },
      'stuck shopify job FAILED — store credits refunded',
    );
  }
}
