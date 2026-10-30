import { type DB, schema } from '@aivastra/db';
import type { Logger } from '@aivastra/logger';
import { dispatcherParkedJobs } from '@aivastra/observability';
import { inArray } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import type { OwnerToken } from '../job/ownership.js';
import type { ProcessorConfig } from '../job/processor.js';
import { workerReleased } from '../worker/registry.js';
import { listClaimableWorkers } from '../worker/selector.js';
import { type Lane, laneOf } from './lane-tickets.js';

/**
 * Jobs waiting for a worker of their pool.
 *
 * A job that finds no worker used to sleep 10 s inside its lane slot and re-add itself, which
 * held a slot with no GPU behind it (jobs that could run sat unread in the stream), let whichever
 * retry timer fired first win a freed worker, and rewrote PREPROCESSING on every retry. Now it
 * parks: it leaves the lane (no slot), keeps its lease renewed and its message pending, and waits
 * here. When a worker frees up, the job that has waited longest for a pool that worker serves is
 * resumed, in arrival order, within about a second.
 *
 * One dispatcher process is guaranteed (a second live session is refused), so ordering in memory
 * is enough; the ordering key comes from Postgres (queued_at), so it survives a restart: the
 * pending messages are recovered, re-parked and sorted again.
 */

/**
 * Most jobs parked at once. A parked job costs a small in-memory record and one slot in the
 * single batched lease renewal, so this protects memory and the database from a flood of
 * messages for a pool with no worker. Beyond it the lane stops reading and the messages stay in
 * the stream: head-of-line blocking can come back only after this many jobs are stuck at once.
 */
export const MAX_PARKED = 200;

/** A normal or low job that has waited this long ranks as priority (was 18 retries of 10 s). */
export const PROMOTE_AFTER_MS = 180_000;

/** Fallback poll; the release event normally wakes the scheduler first. */
const TICK_MS = 1_000;

const RANK: Record<string, number> = { 'jobs:priority': 0, 'jobs:normal': 1, 'jobs:low': 2 };
export const streamRank = (stream: string): number => RANK[stream] ?? 1;

export interface ParkedJob {
  owner: OwnerToken;
  cfg: ProcessorConfig;
  jobId: string;
  userId: string;
  stream: string;
  messageId: string;
  retryCount: number;
  pool: string;
  /** `jobs.queued_at ?? created_at` (ms): arrival order, read from Postgres. */
  queuedAtMs: number;
  /** The 3 h queue-wait limit: past it the job is resumed so its normal terminate-with-refund runs. */
  expiresAtMs: number;
  parkedAtMs: number;
  /** Set once the scheduler has picked the job to resume (waiting for a lane slot). */
  assignedWorker?: string;
}

export interface LaneControl {
  /** Starts the job in the lane if it has a free slot; false when it has none. */
  tryStart(job: ParkedJob): boolean;
}

const jobs = new Map<string, ParkedJob>();
/** Resumed and not yet past the worker claim (or parked again): at most one head per pool. */
const resuming = new Map<string, ParkedJob>();
const lanes = new Map<Lane, LaneControl>();
const announced = new Set<string>();
let logger: Logger | undefined;

const effectiveRank = (j: ParkedJob, now: number) =>
  now - j.parkedAtMs >= PROMOTE_AFTER_MS ? 0 : streamRank(j.stream);
const byOrder = (now: number) => (a: ParkedJob, b: ParkedJob) =>
  effectiveRank(a, now) - effectiveRank(b, now) ||
  a.queuedAtMs - b.queuedAtMs ||
  a.jobId.localeCompare(b.jobId);

function publishGauge(): void {
  const counts = new Map<string, number>();
  for (const j of jobs.values()) counts.set(j.pool, (counts.get(j.pool) ?? 0) + 1);
  for (const pool of seenPools) dispatcherParkedJobs.set({ pool }, counts.get(pool) ?? 0);
}
const seenPools = new Set<string>();

let maxParked = MAX_PARKED;
/** The cap the lanes read against; tests lower it to reach it with a handful of jobs. */
export const maxParkedJobs = (): number => maxParked;
export const setMaxParkedForTest = (n: number): void => {
  maxParked = n;
};
export const parkedCount = (): number => jobs.size;
export const parkedJobIds = (): string[] => [...jobs.keys()];
export const isParked = (jobId: string): boolean => jobs.has(jobId);
export const registerLane = (lane: Lane, control: LaneControl): void => {
  lanes.set(lane, control);
};
export const unregisterLane = (lane: Lane): void => {
  lanes.delete(lane);
};

/** The job's waiting event and SSE-free status are written once, when it first parks. */
export function forgetWaiting(jobId: string): void {
  announced.delete(jobId);
  if (resuming.delete(jobId)) kick();
}

/** The resumed job's handler returned (claimed a worker, re-parked, finished or failed). */
export function resumeEnded(jobId: string): void {
  if (resuming.delete(jobId)) kick();
}

export async function park(job: ParkedJob, db: DB, log: Logger): Promise<void> {
  logger ??= log;
  const first = !announced.has(job.jobId);
  if (first) {
    announced.add(job.jobId);
    await db
      .insert(schema.jobEvents)
      .values({
        jobId: job.jobId,
        eventType: 'WAITING_FOR_WORKER',
        payload: { pool: job.pool },
      })
      .catch((err) => log.warn({ err, jobId: job.jobId }, 'could not record WAITING_FOR_WORKER'));
  }
  resuming.delete(job.jobId);
  jobs.set(job.jobId, job);
  seenPools.add(job.pool);
  publishGauge();
  log.info(
    {
      stage: 'park',
      jobId: job.jobId,
      userId: job.userId,
      pool: job.pool,
      stream: job.stream,
      generation: job.owner.generation,
      parked: jobs.size,
      first,
    },
    'job parked waiting for a worker',
  );
  kick();
}

/** Removes a job from the waiting set (dispatch, or shutdown). */
function take(job: ParkedJob): void {
  jobs.delete(job.jobId);
  publishGauge();
}

let evaluating = false;
let again = false;
let deps: { db: DB; redis: Redis; log: Logger } | undefined;

/** Schedules an evaluation now; overlapping requests collapse into one follow-up run. */
export function kick(): void {
  if (!deps) return;
  if (evaluating) {
    again = true;
    return;
  }
  evaluating = true;
  void evaluate(deps)
    .catch((err) => deps?.log.error({ err }, 'parked-job scheduler failed'))
    .finally(() => {
      evaluating = false;
      if (again) {
        again = false;
        kick();
      }
    });
}

function dispatch(job: ParkedJob, why: string, log: Logger): boolean {
  const lane = lanes.get(laneOf(job.stream));
  if (!lane) return false;
  if (!lane.tryStart(job)) return false;
  take(job);
  resuming.set(job.jobId, job);
  log.info(
    {
      stage: 'resume',
      jobId: job.jobId,
      pool: job.pool,
      why,
      waitedMs: Date.now() - job.parkedAtMs,
      workerHint: job.assignedWorker,
    },
    'parked job resumed',
  );
  return true;
}

async function evaluate(d: { db: DB; redis: Redis; log: Logger }): Promise<void> {
  const { db, redis, log } = d;
  const started = performance.now();
  const now = Date.now();
  if (jobs.size === 0) return;

  // Jobs that must run through their normal path now whatever the pools look like: finished
  // (cancelled while waiting: the resume ACKs it) or past the 3 h limit (the resume terminates
  // it with a refund). Neither needs a worker.
  const ids = [...jobs.keys()];
  const finished = new Set(
    (
      await db
        .select({ id: schema.jobs.id, status: schema.jobs.status })
        .from(schema.jobs)
        .where(inArray(schema.jobs.id, ids))
    )
      .filter((r) => ['COMPLETED', 'FAILED', 'CANCELLED'].includes(r.status))
      .map((r) => r.id),
  );
  for (const job of [...jobs.values()]) {
    if (finished.has(job.jobId)) dispatch(job, 'finished_while_waiting', log);
    else if (now >= job.expiresAtMs) dispatch(job, 'queue_wait_expired', log);
  }

  // Heads: the oldest waiter of each pool, resumed only while no earlier head of that pool is
  // still choosing a worker. A freed worker goes to the oldest head among the pools it serves
  // (heads are visited in global order and each takes a distinct worker), so two pools never
  // race for one worker.
  const assigned = new Set<string>();
  for (const j of resuming.values()) if (j.assignedWorker) assigned.add(j.assignedWorker);
  const resumingPools = new Set([...resuming.values()].map((j) => j.pool));
  const heads = new Map<string, ParkedJob>();
  for (const job of [...jobs.values()].sort(byOrder(now))) {
    if (!heads.has(job.pool) && !resumingPools.has(job.pool)) heads.set(job.pool, job);
  }
  for (const head of [...heads.values()].sort(byOrder(now))) {
    const claimable = await listClaimableWorkers(redis, head.pool as never, [...assigned]);
    const worker = claimable[0];
    if (!worker) continue;
    head.assignedWorker = worker;
    if (dispatch(head, 'worker_available', log)) assigned.add(worker);
    else head.assignedWorker = undefined;
  }
  log.debug(
    {
      stage: 'parked_evaluate',
      durationMs: performance.now() - started,
      parked: jobs.size,
      resuming: resuming.size,
    },
    'parked-job scheduler pass',
  );
}

/** Starts the fallback poll and the release listener. Returns the stopper (shutdown). */
export function startParkedScheduler(args: { db: DB; redis: Redis; log: Logger }): () => void {
  deps = args;
  logger = args.log;
  const onRelease = () => kick();
  workerReleased.on('released', onRelease);
  const timer = setInterval(kick, TICK_MS);
  timer.unref();
  return () => {
    clearInterval(timer);
    workerReleased.off('released', onRelease);
    deps = undefined;
  };
}

/** Test hook: forget every waiter and registered lane. */
export function resetParked(): void {
  jobs.clear();
  resuming.clear();
  lanes.clear();
  announced.clear();
  seenPools.clear();
  maxParked = MAX_PARKED;
  evaluating = false;
  again = false;
  deps = undefined;
}
