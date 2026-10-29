import { randomUUID } from 'node:crypto';
import { type DB, type DbTransaction, schema } from '@aivastra/db';
import type { Logger } from '@aivastra/logger';
import { dispatcherOwnershipEventsTotal } from '@aivastra/observability';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { recordSubmissionOutcome } from './submission.js';

// A 30s lease renewed every 5s tolerates several missed ticks (GC pause, a slow
// Postgres round trip) before a live process loses its jobs, yet a SIGKILLed one
// becomes recoverable within half a minute. Both are measured on Postgres time.
export const LEASE_MS = 30_000;
export const LEASE_RENEW_INTERVAL_MS = 5_000;

// Random per process incarnation: a hostname survives a container restart, so it
// could never tell the new process from the one that died.
export const processSession = randomUUID();

const TERMINAL = ['COMPLETED', 'FAILED', 'CANCELLED'];
export const isTerminalStatus = (status: string) => TERMINAL.includes(status);

export interface OwnerToken {
  jobId: string;
  session: string;
  generation: number;
}

export type Acquisition =
  | { kind: 'Acquired'; owner: OwnerToken }
  | { kind: 'LiveOwner' }
  | { kind: 'Terminal'; status: string }
  | { kind: 'Recoverable'; status: string };

export class OwnershipLostError extends Error {
  constructor(
    readonly jobId: string,
    readonly site: string,
    readonly owner?: OwnerToken,
  ) {
    super(`ownership of job ${jobId} lost (${site})`);
  }
}

function countEvent(event: string): void {
  dispatcherOwnershipEventsTotal.inc({ event });
}

// clock_timestamp(), never now(): now() is the transaction start, so a long
// transaction would compare a stale instant against the lease.
const LEASE_EXPIRY = sql.raw(`clock_timestamp() + interval '${LEASE_MS} milliseconds'`);

async function lockControl(tx: DbTransaction, jobId: string) {
  const [row] = await tx
    .select({
      ownerSession: schema.dispatcherJobControl.ownerSession,
      generation: sql<number>`${schema.dispatcherJobControl.generation}::integer`,
      live: sql<boolean>`(not ${schema.dispatcherJobControl.ownerRetired}
        and ${schema.dispatcherJobControl.leaseUntil} is not null
        and ${schema.dispatcherJobControl.leaseUntil} > clock_timestamp())`,
    })
    .from(schema.dispatcherJobControl)
    .where(eq(schema.dispatcherJobControl.jobId, jobId))
    .for('update');
  return row;
}

async function bumpGeneration(tx: DbTransaction, jobId: string, session: string): Promise<number> {
  const rows = await tx.execute(sql`
    insert into dispatcher_job_control (job_id, owner_session, generation, lease_until, owner_retired)
    values (${jobId}, ${session}, 1, ${LEASE_EXPIRY}, false)
    on conflict (job_id) do update set
      owner_session = excluded.owner_session,
      generation = dispatcher_job_control.generation + 1,
      lease_until = excluded.lease_until,
      owner_retired = false
    returning generation::integer as generation`);
  return Number((rows[0] as { generation: number }).generation);
}

/**
 * The single admission point for a paid Comfy job. Locks `jobs` first and the
 * control row second — the order submitRecordedPhase already uses — so no pair of
 * transactions can deadlock.
 *
 * `takeover` is the recovery form: it bumps the generation without the QUEUED
 * compare-and-set, for a job a dead process left mid-flight.
 */
async function acquireInTransaction(
  tx: DbTransaction,
  jobId: string,
  session: string,
  takeover: boolean,
  eventPayload: Record<string, unknown> = {},
): Promise<Acquisition> {
  const [job] = await tx
    .select({ status: schema.jobs.status })
    .from(schema.jobs)
    .where(eq(schema.jobs.id, jobId))
    .for('update');
  // PENDING_MANNEQUIN and a vanished row take the same "nothing to do" exit the
  // processor always gave a non-QUEUED, non-in-progress job.
  if (!job) return { kind: 'Terminal', status: 'MISSING' };
  if (TERMINAL.includes(job.status)) return { kind: 'Terminal', status: job.status };

  const control = await lockControl(tx, jobId);
  // Applies even while jobs.status is QUEUED: a no-worker requeue sets QUEUED and
  // then sleeps 10s still holding its lease.
  if (control?.live) return { kind: 'LiveOwner' };

  const inFlight = ['PREPROCESSING', 'GENERATING', 'UPLOADING'].includes(job.status);
  if (takeover ? !inFlight : job.status !== 'QUEUED') {
    return inFlight
      ? { kind: 'Recoverable', status: job.status }
      : { kind: 'Terminal', status: job.status };
  }

  const generation = await bumpGeneration(tx, jobId, session);
  if (!takeover) {
    await tx.update(schema.jobs).set({ status: 'PREPROCESSING' }).where(eq(schema.jobs.id, jobId));
    await tx
      .insert(schema.jobEvents)
      .values({ jobId, eventType: 'PREPROCESSING', payload: eventPayload });
  }
  return { kind: 'Acquired', owner: { jobId, session, generation } };
}

export async function acquireComfyJob(
  db: DB,
  jobId: string,
  session: string,
  log: Logger,
  /** PREPROCESSING event payload; Shopify jobs carry `{ shopifyStoreId }` as before. */
  eventPayload: Record<string, unknown> = {},
): Promise<Acquisition> {
  const startedAt = performance.now();
  const result = await db.transaction((tx) =>
    acquireInTransaction(tx, jobId, session, false, eventPayload),
  );
  const outcome = {
    Acquired: 'acquired',
    LiveOwner: 'live_owner',
    Terminal: 'terminal',
    Recoverable: 'recoverable',
  }[result.kind];
  log.info(
    {
      stage: 'acquire_ownership',
      durationMs: performance.now() - startedAt,
      outcome,
      session,
      ...(result.kind === 'Acquired' ? { generation: result.owner.generation } : {}),
    },
    'job stage timing',
  );
  if (result.kind === 'Acquired') countEvent('acquired');
  else if (result.kind === 'LiveOwner') countEvent('live_owner');
  else if (result.kind === 'Recoverable') countEvent('recoverable');
  return result;
}

/** Fresh generation for a job found in flight with no live owner (legacy recovery). */
export async function takeoverComfyJob(
  db: DB,
  jobId: string,
  session: string,
): Promise<Acquisition> {
  return db.transaction((tx) => takeoverInTransaction(tx, jobId, session));
}

/** The sweeper takes its generation inside the same transaction as its refund writes. */
export async function takeoverInTransaction(
  tx: DbTransaction,
  jobId: string,
  session: string,
): Promise<Acquisition> {
  const result = await acquireInTransaction(tx, jobId, session, true);
  if (result.kind === 'Acquired') countEvent('acquired');
  return result;
}

/**
 * Must run inside the transaction that holds the mutation, before its first
 * write: a check made outside it can be overtaken by an expiry before commit.
 */
export async function assertOwnerInTransaction(
  tx: DbTransaction,
  owner: OwnerToken,
  site: string,
): Promise<string> {
  const [job] = await tx
    .select({ status: schema.jobs.status })
    .from(schema.jobs)
    .where(eq(schema.jobs.id, owner.jobId))
    .for('update');
  const control = job ? await lockControl(tx, owner.jobId) : undefined;
  // A terminal job is deliberately not a loss: an API cancel while this process
  // still holds the lease must keep its legacy handling (the guarded write is skipped
  // and the message ACKed). Overwriting a terminal row is blocked by the writes
  // themselves, and a *stale* owner fails on session/generation/lease below.
  if (
    !job ||
    !control ||
    control.ownerSession !== owner.session ||
    control.generation !== owner.generation ||
    !control.live
  )
    throw new OwnershipLostError(owner.jobId, site, owner);
  return job.status;
}

// Jobs this process is working on right now. Renewing every row the session ever
// acquired would keep a finished (or crashed-handler) job "live" until restart,
// blinding the sweeper and recovery, and the row count would grow without bound.
const inFlight = new Map<string, { session: string; generation: number }>();

/**
 * Starts renewing the job's lease. Renewal belongs to the in-flight set rather than
 * to index.ts so the processor renews identically in production and in tests; a job
 * that outlives one lease period (a two-phase saree run, the 10s no-worker wait)
 * must keep its ownership wherever it runs. `renew` is omitted only by tests that
 * drive `renewLeases` by hand.
 */
export function trackOwnedJob(owner: OwnerToken, renew?: { db: DB; log: Logger }): void {
  inFlight.set(owner.jobId, { session: owner.session, generation: owner.generation });
  if (renew) ensureRenewalTimer(renew.db, renew.log);
}

/** Removes the entry only if it still belongs to this generation. */
export function untrackOwnedJob(owner: OwnerToken): void {
  if (inFlight.get(owner.jobId)?.generation === owner.generation) inFlight.delete(owner.jobId);
  if (inFlight.size === 0 && renewalTimer) {
    clearInterval(renewalTimer);
    renewalTimer = undefined;
  }
}

/** Extends only live leases of jobs in flight here; an expired or retired lease is never revived. */
export async function renewLeases(db: DB, session: string): Promise<number> {
  const ids = [...inFlight].filter(([, v]) => v.session === session).map(([jobId]) => jobId);
  if (ids.length === 0) return 0;
  const rows = await db
    .update(schema.dispatcherJobControl)
    .set({ leaseUntil: LEASE_EXPIRY })
    .where(
      and(
        inArray(schema.dispatcherJobControl.jobId, ids),
        eq(schema.dispatcherJobControl.ownerSession, session),
        eq(schema.dispatcherJobControl.ownerRetired, false),
        sql`${schema.dispatcherJobControl.leaseUntil} > clock_timestamp()`,
      ),
    )
    .returning({ jobId: schema.dispatcherJobControl.jobId });
  return rows.length;
}

/**
 * Ends this handler's authority once it is done with the job, whatever the exit
 * (an unexpected error included), so a finished or crashed handler never leaves a
 * live lease behind. The generation match keeps it from retiring a newer owner.
 */
export async function retireOwnership(db: DB | DbTransaction, owner: OwnerToken): Promise<void> {
  await db
    .update(schema.dispatcherJobControl)
    .set({ ownerRetired: true })
    .where(
      and(
        eq(schema.dispatcherJobControl.jobId, owner.jobId),
        eq(schema.dispatcherJobControl.ownerSession, owner.session),
        sql`${schema.dispatcherJobControl.generation} = ${owner.generation}`,
      ),
    );
}

let renewalTimer: NodeJS.Timeout | undefined;
let renewing = false;

function ensureRenewalTimer(db: DB, log: Logger): void {
  if (renewalTimer) return;
  renewalTimer = setInterval(() => {
    if (renewing) return;
    renewing = true;
    // One tick renews every in-flight session; the set only ever holds this process's jobs.
    const sessions = new Set([...inFlight.values()].map((v) => v.session));
    Promise.all([...sessions].map((session) => renewLeases(db, session)))
      .catch((err) => {
        // The per-transaction guard is the real protection; a missed renewal only
        // shortens how long this process keeps its jobs.
        countEvent('renew_failed');
        log.error({ err }, 'ownership lease renewal failed');
      })
      .finally(() => {
        renewing = false;
      });
  }, LEASE_RENEW_INTERVAL_MS);
  renewalTimer.unref();
}

export interface YieldPatch {
  /** The failed attempt is requeued: mark its execution attempt FAILED (Phase A bookkeeping). */
  failedAttempt?: boolean;
}

/**
 * Hands a job back for a retry: status QUEUED and authority retired in one fenced
 * transaction, before the replacement message is published, so a replacement that
 * is consumed immediately finds no live owner.
 *
 * A job that already finished (a user cancelled it during the no-worker sleep, an
 * admin cancelled it mid-run) is never reopened: the result is 'terminal' and the
 * caller ACKs without re-adding it to the queue.
 */
export async function yieldComfyJob(
  db: DB,
  owner: OwnerToken,
  patch: YieldPatch,
  log: Logger,
): Promise<'yielded' | 'lost' | 'terminal'> {
  try {
    const outcome = await db.transaction(async (tx) => {
      const status = await assertOwnerInTransaction(tx, owner, 'yield');
      if (isTerminalStatus(status)) {
        await retireOwnership(tx, owner);
        return 'terminal' as const;
      }
      await tx.update(schema.jobs).set({ status: 'QUEUED' }).where(eq(schema.jobs.id, owner.jobId));
      if (patch.failedAttempt) await recordSubmissionOutcome(tx, owner.jobId, 'FAILED', log);
      await retireOwnership(tx, owner);
      return 'yielded' as const;
    });
    countEvent('yield');
    return outcome;
  } catch (err) {
    if (!(err instanceof OwnershipLostError)) throw err;
    noteOwnershipLost(log, owner, err.site);
    return 'lost';
  }
}

export function noteOwnershipLost(log: Logger, owner: OwnerToken, site: string): void {
  countEvent('lost');
  log.warn(
    {
      stage: 'ownership_lost',
      site,
      jobId: owner.jobId,
      session: owner.session,
      generation: owner.generation,
    },
    'ownership lost — stopping work on this job without failing, refunding or ACKing it',
  );
}
