import { type DB, schema } from '@aivastra/db';
import type { Logger } from '@aivastra/logger';
import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { processSession } from '../job/ownership.js';
import { type ProcessorConfig, processJob } from '../job/processor.js';
import { settleAndPublish } from '../job/settlement.js';
import { releaseStoreCapSlot } from '../shopify/store-cap.js';
import { NO_MESSAGE_ID } from './delivery.js';
import { takeTicket } from './lane-tickets.js';

// In-flight jobs whose work started (or, for PREPROCESSING, were created) longer ago than
// this are stuck — a normal try-on completes in ~30-60s, so 15m means the dispatcher died
// mid-flight.
const IN_FLIGHT_SLA_MS = 15 * 60 * 1000;
const IN_FLIGHT_STATES = ['PREPROCESSING', 'GENERATING', 'UPLOADING'];
// An adoption can wait minutes on a running prompt, so it runs in the background like a
// recovered job: the tick never waits on it, and only a few run at once. The rest wait for the
// next tick (a job already adopted holds a live lease, so a later tick skips it).
const ADOPT_BACKGROUND_CAP = 3;
const adopting = new Map<string, Promise<void>>();

/** Resolves once every adoption the sweeper has started has finished (tests, shutdown). */
export async function sweeperIdle(): Promise<void> {
  while (adopting.size > 0) await Promise.allSettled([...adopting.values()]);
}

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
  /** Retries already spent (`jobs.attempts`). */
  attempts: number;
  /** The lane the job was enqueued on; a requeue goes back to it. */
  queueStream: string;
  /** A paid-Comfy job with an attempt record: what is running on its worker can be looked up. */
  hasAttempt: boolean;
}

const SELECT_COLS = {
  id: schema.jobs.id,
  userId: schema.jobs.userId,
  merchantId: schema.jobs.merchantId,
  shopifyStoreId: schema.jobs.shopifyStoreId,
  creditsCharged: schema.jobs.creditsCharged,
  params: schema.jobInputs.params,
  attempts: schema.jobs.attempts,
  queueStream: schema.jobs.queueStream,
  hasAttempt: sql<boolean>`exists (select 1 from execution_attempts ea where ea.job_id = ${schema.jobs.id})`,
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
  // When given, expired paid-Comfy jobs with an attempt record go through adoption instead of
  // being failed by age.
  cfg?: ProcessorConfig,
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
      // Age says nothing about what the worker did: the GPU may have finished the image.
      // Video jobs and jobs from before attempts were tracked have nothing to look up and
      // keep the age rule.
      if (cfg && job.hasAttempt) {
        if (adopting.has(job.id)) continue;
        if (adopting.size >= ADOPT_BACKGROUND_CAP) {
          log.info({ jobId: job.id }, 'sweeper adoption slots full — left for the next tick');
          continue;
        }
        startAdoption(cfg, job, log);
        continue;
      }
      await failAndRefund(db, redis, pub, job, 'STUCK_IN_FLIGHT', log, session);
    }
  } catch (err) {
    log.error({ err }, 'failed to sweep stuck jobs');
  }
}

/**
 * The same takeover, adoption and settlement path recovery uses, with no stream message behind
 * it: nothing to ACK, and a requeue appends a fresh message. It runs as an ordinary owned job
 * (lease renewed while it runs, generation retired on exit), in the background. A finished
 * prompt is finalized, a running one is waited on and settled when it ends, and only a real
 * final failure is failed and refunded, through settleComfyJob.
 */
function startAdoption(cfg: ProcessorConfig, job: StuckJob, log: Logger): void {
  const stream = `jobs:${job.queueStream}`;
  // The job has no queue entry for the lane to count, so it takes a ticket of its own: while it
  // runs it occupies a slot of its lane exactly like a recovered job, whatever the cap is.
  const release = takeTicket(stream, `sweep:${job.id}`);
  const run: Promise<void> = processJob(
    cfg,
    job.id,
    job.userId ?? '',
    stream,
    NO_MESSAGE_ID,
    job.attempts,
  )
    .finally(release)
    .catch((err) => log.error({ err, jobId: job.id }, 'sweeper adoption failed'))
    .finally(() => {
      adopting.delete(job.id);
    });
  adopting.set(job.id, run);
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
