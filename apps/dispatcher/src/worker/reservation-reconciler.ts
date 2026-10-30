import { type DB, schema } from '@aivastra/db';
import type { Logger } from '@aivastra/logger';
import {
  dispatcherReservationFinishedHoldSeconds,
  dispatcherReservationReconcileStaleSeconds,
  dispatcherReservationReconcileTotal,
  dispatcherReservationUnknownHoldSeconds,
} from '@aivastra/observability';
import type { WorkerPool } from '@aivastra/types';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import {
  findPromptByClientId,
  findPromptById,
  type PromptSearchResult,
} from '../comfyui/reconcile.js';
import {
  ADMISSION_KEY,
  getReservations,
  isTransientToken,
  REGISTRY_KEY,
  type RegistrableWorker,
  registerWorkers,
  releaseWorkerIfToken,
  reservationToken,
} from './registry.js';

/**
 * Worker reservations: rebuilt from Postgres at boot, released only on evidence, and cleaned up
 * on a schedule. Nothing here adopts, finalizes, settles, refunds, creates an attempt or POSTs:
 * the only writes are Redis hold bookkeeping and, on the attempt row, a diagnostic receipt, a
 * persisted search deadline and `resolved_at` once the remote work is shown to have ended.
 */

export interface ReservationReconcilerCfg {
  db: DB;
  redis: Redis;
  log: Logger;
  /** How long a dead owner's receipt-less SUBMITTING attempt is searched for. */
  uncertainCheckMs: number;
  /** This process's session, kept alive on the active-session marker by the tick. */
  session?: string;
  /** Clock for hold ages; tests move it to prove the 120 s alert without waiting. */
  now?: () => number;
}

export type ReconcileOutcome =
  | 'released'
  | 'held_running'
  | 'held_search'
  | 'held_unavailable'
  | 'receipt_conflict'
  | 'skipped_live_owner'
  | 'skipped_transient'
  | 'cleared_stale'
  | 'token_replaced'
  | 'quarantined';

type Attempt = typeof schema.executionAttempts.$inferSelect;

const BATCH_SIZE = 8;
const TICK_MS = 10_000;

// Hold-age bookkeeping for the alert gauges. In memory on purpose: a failed read must not reset
// an age, and a restart starting it again is the conservative direction (it alerts later, never
// earlier, than the true age, and the boot reconcile runs before the first tick).
interface HoldClock {
  heldSince: number;
  lastVerified: number | null;
  finishedSince: number | null;
  unknownSince: number | null;
}
const holds = new Map<string, HoldClock>();

let nowMs: () => number = Date.now;

function clockFor(workerId: string): HoldClock {
  let clock = holds.get(workerId);
  if (!clock) {
    clock = { heldSince: nowMs(), lastVerified: null, finishedSince: null, unknownSince: null };
    holds.set(workerId, clock);
  }
  return clock;
}

function publishGauges(workerId: string): void {
  const clock = holds.get(workerId);
  const now = nowMs();
  const age = (since: number | null) => (since === null ? 0 : (now - since) / 1000);
  dispatcherReservationReconcileStaleSeconds.set(
    { worker_id: workerId },
    clock ? age(clock.lastVerified ?? clock.heldSince) : 0,
  );
  dispatcherReservationFinishedHoldSeconds.set(
    { worker_id: workerId },
    age(clock?.finishedSince ?? null),
  );
  dispatcherReservationUnknownHoldSeconds.set(
    { worker_id: workerId },
    age(clock?.unknownSince ?? null),
  );
}

function clearHold(workerId: string): void {
  holds.delete(workerId);
  publishGauges(workerId);
}

/** Test seam: forget in-process ages so each test starts from a clean clock. */
export function resetReservationClocks(): void {
  for (const workerId of holds.keys()) clearHold(workerId);
  holds.clear();
}

function parseToken(
  token: string,
): { session: string; generation: string; attemptId: string } | null {
  const parts = token.split(':');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return null;
  return { session: parts[0], generation: parts[1], attemptId: parts[2] };
}

async function loadAttempt(db: DB, attemptId: string): Promise<Attempt | undefined> {
  const [attempt] = await db
    .select()
    .from(schema.executionAttempts)
    .where(eq(schema.executionAttempts.id, attemptId));
  return attempt;
}

/** True while the token's owner still holds an unretired, unexpired DB lease (database time). */
async function ownerIsLive(
  db: DB,
  attempt: Attempt,
  parsed: { session: string; generation: string },
): Promise<boolean> {
  if (!attempt.jobId) return false;
  const [row] = await db
    .select({
      live: sql<boolean>`(${schema.dispatcherJobControl.ownerSession} = ${parsed.session}::uuid
        and ${schema.dispatcherJobControl.generation} = ${parsed.generation}::bigint
        and not ${schema.dispatcherJobControl.ownerRetired}
        and ${schema.dispatcherJobControl.leaseUntil} > clock_timestamp())`,
    })
    .from(schema.dispatcherJobControl)
    .where(eq(schema.dispatcherJobControl.jobId, attempt.jobId));
  return row?.live === true;
}

/**
 * Persists the first search deadline once. Restarts and later ticks read the stored value, so
 * the window never resets. Database time, not the Node clock.
 */
async function ensureDeadline(cfg: ReservationReconcilerCfg, attemptId: string): Promise<Date> {
  const [row] = await cfg.db
    .update(schema.executionAttempts)
    .set({
      uncertainDeadline: sql`clock_timestamp() + (${cfg.uncertainCheckMs}::double precision * interval '1 millisecond')`,
    })
    .where(
      and(
        eq(schema.executionAttempts.id, attemptId),
        isNull(schema.executionAttempts.uncertainDeadline),
      ),
    )
    .returning({ deadline: schema.executionAttempts.uncertainDeadline });
  if (row?.deadline) return row.deadline;
  const [existing] = await cfg.db
    .select({ deadline: schema.executionAttempts.uncertainDeadline })
    .from(schema.executionAttempts)
    .where(eq(schema.executionAttempts.id, attemptId));
  if (!existing?.deadline) throw new Error('uncertain deadline could not be read back');
  return existing.deadline;
}

async function deadlinePassed(db: DB, attemptId: string): Promise<boolean> {
  const [row] = await db
    .select({
      passed: sql<boolean>`${schema.executionAttempts.uncertainDeadline} <= clock_timestamp()`,
    })
    .from(schema.executionAttempts)
    .where(eq(schema.executionAttempts.id, attemptId));
  return row?.passed === true;
}

type ReceiptRecord = 'recorded' | 'identical' | 'conflict' | 'stale';

/**
 * Records a discovered prompt id as a diagnostic receipt: under the attempt-row lock, fill a
 * missing one only. It never changes the attempt's state, the job, its owner, its retry budget
 * or any money, and does not impersonate the dead owner.
 */
async function recordDiscoveredReceipt(
  cfg: ReservationReconcilerCfg,
  attempt: Attempt,
  promptId: string,
  observation: string,
): Promise<ReceiptRecord> {
  return cfg.db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(schema.executionAttempts)
      .where(eq(schema.executionAttempts.id, attempt.id))
      .for('update');
    // Identity was validated before the network reads and must still hold after them.
    if (!row || row.clientId !== attempt.clientId || row.workerId !== attempt.workerId)
      return 'stale';
    if (row.promptId) return row.promptId === promptId ? 'identical' : 'conflict';
    await tx
      .update(schema.executionAttempts)
      .set({ promptId, updatedAt: new Date() })
      .where(eq(schema.executionAttempts.id, attempt.id));
    if (row.jobId)
      await tx.insert(schema.jobEvents).values({
        jobId: row.jobId,
        eventType: 'COMFY_RECEIPT_DISCOVERED',
        payload: {
          attemptId: row.id,
          clientId: row.clientId,
          phase: row.phase,
          workerId: row.workerId,
          promptId,
          observation,
        },
      });
    return 'recorded';
  });
}

/** The only three facts that end remote work, and the name each is audited under. */
const RESOLVING_RULES = new Set([
  'prompt_succeeded',
  'prompt_failed',
  'known_prompt_absent',
  'client_absent_after_deadline',
]);

/**
 * Records that the remote prompt has ended: `resolved_at` plus a diagnostic job event naming the
 * rule, in one transaction. It states a fact about the worker, never business state: the
 * attempt's state, the job, its ownership and any money are untouched.
 */
async function markResolved(
  db: DB,
  attempt: Attempt,
  workerId: string,
  rule: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  if (!RESOLVING_RULES.has(rule)) return;
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(schema.executionAttempts)
      .set({ resolvedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(schema.executionAttempts.id, attempt.id),
          isNull(schema.executionAttempts.resolvedAt),
        ),
      )
      .returning({ id: schema.executionAttempts.id });
    if (row && attempt.jobId)
      await tx.insert(schema.jobEvents).values({
        jobId: attempt.jobId,
        eventType: 'COMFY_RESERVATION_RESOLVED',
        payload: { rule, attemptId: attempt.id, clientId: attempt.clientId, workerId, ...extra },
      });
  });
}

async function releaseExact(
  cfg: ReservationReconcilerCfg,
  workerId: string,
  token: string,
  attempt: Attempt,
  reason: string,
  extra: Record<string, unknown> = {},
): Promise<ReconcileOutcome> {
  // Resolve first: a crash between the two leaves a held token over a resolved attempt, which
  // the next tick releases, never a free worker over unresolved remote work.
  // A PREPARING attempt never reached a worker, and one already resolved needs nothing more.
  await markResolved(cfg.db, attempt, workerId, reason, extra);
  const released = await releaseWorkerIfToken(cfg.redis, workerId, token);
  if (!released) return 'token_replaced';
  clearHold(workerId);
  cfg.log.info(
    {
      stage: 'reservation_release',
      workerId,
      attemptId: attempt.id,
      clientId: attempt.clientId,
      phase: attempt.phase,
      jobId: attempt.jobId,
      reason,
    },
    'worker reservation released',
  );
  return 'released';
}

interface WorkerIdentity {
  url: string;
  apiKey: string;
}

async function workerIdentity(
  redis: Redis,
  workerId: string,
  attempt: Attempt,
): Promise<WorkerIdentity | 'quarantined' | null> {
  const raw = await redis.hget(REGISTRY_KEY, workerId);
  if (!raw) return null;
  const entry = JSON.parse(raw) as { url?: string; apiKey?: string };
  if (!entry.url || !entry.apiKey) return null;
  // A rename or re-point with unresolved work is never solved by sending the request, or its
  // key, to a different endpoint.
  if (attempt.workerUrl && attempt.workerUrl.replace(/\/$/, '') !== entry.url.replace(/\/$/, ''))
    return 'quarantined';
  return { url: entry.url, apiKey: entry.apiKey };
}

/**
 * Acts on one worker's hold. `owner` is the handler releasing its own hold on the way out; the
 * scheduled pass is `reconciler` and must never touch a live owner's hold.
 */
export async function reconcileReservation(
  cfg: ReservationReconcilerCfg,
  workerId: string,
  token: string,
  mode: 'owner' | 'reconciler',
): Promise<ReconcileOutcome> {
  nowMs = cfg.now ?? Date.now;
  if (isTransientToken(token)) return 'skipped_transient';
  const parsed = parseToken(token);
  const attempt = parsed ? await loadAttempt(cfg.db, parsed.attemptId) : undefined;
  if (!parsed || !attempt) {
    // A claim whose attempt never reached the database has no remote work to protect.
    return releaseWorkerIfToken(cfg.redis, workerId, token).then((released) => {
      if (released) clearHold(workerId);
      return released ? 'cleared_stale' : 'token_replaced';
    });
  }
  if (mode === 'reconciler' && (await ownerIsLive(cfg.db, attempt, parsed)))
    return 'skipped_live_owner';

  // The worker was claimed but never bound to the attempt: nothing was uploaded or sent.
  if (!attempt.workerId) return releaseExact(cfg, workerId, token, attempt, 'claimed_never_bound');
  if (attempt.workerId !== workerId) return 'quarantined';

  // Nothing could have reached the worker before the intent committed, or the remote work is
  // already recorded as resolved.
  if (attempt.state === 'PREPARING')
    return releaseExact(cfg, workerId, token, attempt, 'no_submission');
  if (attempt.resolvedAt) return releaseExact(cfg, workerId, token, attempt, 'already_resolved');

  const identity = await workerIdentity(cfg.redis, workerId, attempt);
  if (identity === 'quarantined') return 'quarantined';
  if (!identity) return 'held_unavailable';
  const clock = clockFor(workerId);

  let observed: PromptSearchResult;
  let promptId = attempt.promptId;
  // The handler leaving with an ambiguous POST is not a dead owner: it holds, and the scheduled
  // pass searches once the owner has retired.
  if (mode === 'owner' && !promptId) return 'held_search';
  if (promptId) {
    observed = await findPromptById(identity, promptId, undefined, cfg.log);
  } else {
    // A receipt-less attempt is searched for by its persisted client id until the persisted
    // deadline; a live owner was filtered out above.
    const deadline = await ensureDeadline(cfg, attempt.id);
    observed = await findPromptByClientId(identity, attempt.clientId, deadline, cfg.log);
    clock.unknownSince ??= nowMs();
    if (observed.kind === 'found') {
      const recorded = await recordDiscoveredReceipt(
        cfg,
        attempt,
        observed.promptId,
        observed.observation,
      );
      if (recorded === 'conflict') {
        clock.lastVerified = nowMs();
        return 'receipt_conflict';
      }
      if (recorded === 'stale') return 'token_replaced';
      promptId = observed.promptId;
      clock.unknownSince = null;
    }
  }

  if (observed.kind === 'unavailable') {
    cfg.log.warn(
      { stage: 'reservation_reconcile', workerId, attemptId: attempt.id, reason: observed.reason },
      'worker queue/history could not be verified — reservation held',
    );
    return 'held_unavailable';
  }
  clock.lastVerified = nowMs();

  if (observed.kind === 'found') {
    if (observed.observation === 'queued' || observed.observation === 'running') {
      clock.finishedSince = null;
      return 'held_running';
    }
    clock.finishedSince ??= nowMs();
    return releaseExact(cfg, workerId, token, attempt, `prompt_${observed.observation}`);
  }

  // not_found with a known prompt: it is in neither the queue nor the history, so it cannot
  // still be executing.
  if (promptId)
    return releaseExact(
      cfg,
      workerId,
      token,
      attempt,
      'known_prompt_absent',
      observed.truncated ? { truncated: true } : {},
    );
  // not_found without a receipt: only a fresh complete queue/history check made after the
  // persisted deadline frees the worker. Earlier clean checks never do.
  if (await deadlinePassed(cfg.db, attempt.id))
    return releaseExact(cfg, workerId, token, attempt, 'client_absent_after_deadline');
  return 'held_search';
}

const SUPERSEDED_BATCH = 20;

/**
 * Unresolved attempts that hold no token: a worker keeps one hold, so an older attempt on a
 * worker that a newer attempt took over was left unresolved. Each is checked against its own
 * worker and resolved under the same rules; one still queued or running, with a live owner, or
 * with no receipt is left alone. No hold is taken and nothing else is written.
 */
async function resolveSupersededAttempts(
  cfg: ReservationReconcilerCfg,
  heldTokens: Set<string>,
): Promise<void> {
  const candidates = await cfg.db
    .select()
    .from(schema.executionAttempts)
    .where(
      and(
        isNull(schema.executionAttempts.resolvedAt),
        sql`${schema.executionAttempts.jobId} is not null`,
        sql`${schema.executionAttempts.workerId} is not null`,
        sql`${schema.executionAttempts.promptId} is not null`,
        sql`${schema.executionAttempts.state} <> 'PREPARING'`,
      ),
    )
    .orderBy(schema.executionAttempts.createdAt)
    .limit(SUPERSEDED_BATCH * 4);
  const heldAttemptIds = new Set(
    [...heldTokens].map((token) => parseToken(token)?.attemptId).filter(Boolean),
  );
  const todo = candidates.filter((a) => !heldAttemptIds.has(a.id)).slice(0, SUPERSEDED_BATCH);
  for (let i = 0; i < todo.length; i += BATCH_SIZE) {
    await Promise.all(
      todo.slice(i, i + BATCH_SIZE).map(async (attempt) => {
        try {
          if (!attempt.workerId || !attempt.promptId) return;
          const [control] = attempt.jobId
            ? await cfg.db
                .select({
                  live: sql<boolean>`(not ${schema.dispatcherJobControl.ownerRetired}
                    and ${schema.dispatcherJobControl.leaseUntil} > clock_timestamp())`,
                })
                .from(schema.dispatcherJobControl)
                .where(eq(schema.dispatcherJobControl.jobId, attempt.jobId))
            : [];
          if (control?.live) return;
          const identity = await workerIdentity(cfg.redis, attempt.workerId, attempt);
          if (!identity || identity === 'quarantined') return;
          const observed = await findPromptById(identity, attempt.promptId, undefined, cfg.log);
          if (observed.kind === 'unavailable') return;
          if (observed.kind === 'found') {
            if (observed.observation === 'queued' || observed.observation === 'running') return;
            await markResolved(cfg.db, attempt, attempt.workerId, `prompt_${observed.observation}`);
          } else {
            await markResolved(
              cfg.db,
              attempt,
              attempt.workerId,
              'known_prompt_absent',
              observed.truncated ? { truncated: true } : {},
            );
          }
        } catch (err) {
          cfg.log.warn({ err, attemptId: attempt.id }, 'could not resolve superseded attempt');
        }
      }),
    );
  }
}

/** One pass over every hold, in bounded chunks. */
export async function reconcileWorkerReservations(cfg: ReservationReconcilerCfg): Promise<void> {
  nowMs = cfg.now ?? Date.now;
  if ((await cfg.redis.exists(ADMISSION_KEY)) === 0) return;
  const reservations = [...(await getReservations(cfg.redis))];
  for (let i = 0; i < reservations.length; i += BATCH_SIZE) {
    await Promise.all(
      reservations.slice(i, i + BATCH_SIZE).map(async ([workerId, token]) => {
        const startedAt = performance.now();
        try {
          const outcome = await reconcileReservation(cfg, workerId, token, 'reconciler');
          dispatcherReservationReconcileTotal.inc({ outcome });
          if (outcome !== 'skipped_live_owner' && outcome !== 'skipped_transient')
            cfg.log.info(
              {
                stage: 'reservation_reconcile',
                durationMs: performance.now() - startedAt,
                workerId,
                outcome,
              },
              'reservation reconcile',
            );
        } catch (err) {
          dispatcherReservationReconcileTotal.inc({ outcome: 'error' });
          cfg.log.error({ err, workerId }, 'reservation reconcile failed — reservation held');
        }
        publishGauges(workerId);
      }),
    );
  }
  await resolveSupersededAttempts(cfg, new Set(reservations.map(([, token]) => token)));
  // A worker whose hold is gone has no age left to report.
  const held = new Set(reservations.map(([workerId]) => workerId));
  for (const workerId of [...holds.keys()]) if (!held.has(workerId)) clearHold(workerId);
}

/**
 * Runs the reconcile immediately and then every 10 s. A tick that is still running when the
 * next is due is skipped, so a slow worker cannot stack passes. Returns the stop function.
 */
export function startReservationReconciler(
  cfg: ReservationReconcilerCfg,
  rebuild: () => Promise<void>,
): () => void {
  let running = false;
  let stopped = false;
  const tick = async () => {
    if (running || stopped) return;
    running = true;
    try {
      // A Redis reset drops the admission marker with the registry; claims stay closed until
      // the registry and holds are rebuilt from Postgres again.
      if (cfg.session) await refreshDispatcherSession(cfg.redis, cfg.session);
      if ((await cfg.redis.exists(ADMISSION_KEY)) === 0) await rebuild();
      await reconcileWorkerReservations(cfg);
    } catch (err) {
      cfg.log.error({ err }, 'reservation reconciler tick failed');
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), TICK_MS);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

interface DbWorkerRow {
  id: string;
  url: string;
  apiKey: string;
  isActive: boolean;
  allowedJobTypes: string[] | null;
}

/**
 * Boot-time (and Redis-reset) registry build. Closes admission, rebuilds one hold per worker
 * that still has unresolved remote work, registers every worker (inactive ones as DRAINING so a
 * plain admin reactivation finds them) and only then reopens admission. Anything that held a
 * worker but no longer has unresolved work behind it is dropped, which is what clears a
 * provisional claim whose process died before it bound the worker.
 */
export async function rebuildWorkerRegistry(args: {
  db: DB;
  redis: Redis;
  log: Logger;
  workers: DbWorkerRow[];
}): Promise<{ registered: number; holds: number }> {
  const { db, redis, log, workers } = args;
  await redis.del(ADMISSION_KEY);

  const unresolved = await db
    .select({
      attemptId: schema.executionAttempts.id,
      workerId: schema.executionAttempts.workerId,
      createdAt: schema.executionAttempts.createdAt,
      jobId: schema.executionAttempts.jobId,
      session: schema.dispatcherJobControl.ownerSession,
      generation: schema.dispatcherJobControl.generation,
    })
    .from(schema.executionAttempts)
    .leftJoin(
      schema.dispatcherJobControl,
      eq(schema.dispatcherJobControl.jobId, schema.executionAttempts.jobId),
    )
    // Paid attempts only: classify keeps no durable reservation (plan §9).
    .where(
      and(
        isNull(schema.executionAttempts.resolvedAt),
        sql`${schema.executionAttempts.jobId} is not null`,
        sql`${schema.executionAttempts.workerId} is not null`,
        sql`${schema.executionAttempts.state} <> 'PREPARING'`,
      ),
    )
    .orderBy(schema.executionAttempts.createdAt);

  // One hold per worker, the newest attempt wins: a later claim of the same worker means the
  // earlier work had already ended or been yielded.
  const holdFor = new Map<string, string>();
  for (const row of unresolved) {
    if (!row.workerId) continue;
    holdFor.set(
      row.workerId,
      reservationToken({
        session: row.session ?? '00000000-0000-0000-0000-000000000000',
        generation: row.generation ?? 0n,
        attemptId: row.attemptId,
      }),
    );
  }

  const known = new Set(workers.map((w) => w.id));
  for (const workerId of holdFor.keys()) {
    if (!known.has(workerId))
      log.warn({ workerId }, 'unresolved attempt names a worker that is no longer configured');
  }
  const registrable: RegistrableWorker[] = workers.map((w) => {
    const reservation = holdFor.get(w.id);
    return {
      id: w.id,
      url: w.url,
      apiKey: w.apiKey,
      allowedJobTypes: (w.allowedJobTypes ?? []) as WorkerPool[],
      isActive: w.isActive,
      ...(reservation ? { reservation } : {}),
    };
  });
  await registerWorkers(redis, registrable);
  log.info(
    {
      stage: 'reservation_rebuild',
      registered: registrable.length,
      inactive: registrable.filter((w) => w.isActive === false).length,
      holds: registrable.filter((w) => w.reservation).length,
    },
    'worker registry rebuilt',
  );
  return { registered: registrable.length, holds: registrable.filter((w) => w.reservation).length };
}

// One live dispatcher per Redis (plan §4 step 5): a second process booting beside a healthy one
// would rebuild the registry underneath it. The marker carries a 30 s TTL that the reconciler
// tick refreshes, so a SIGKILLed predecessor only delays the successor until the TTL lapses.
export const ACTIVE_SESSION_KEY = 'dispatcher:active-session';
const ACTIVE_SESSION_TTL_S = 30;

export async function claimDispatcherSession(
  redis: Redis,
  session: string,
  log: Logger,
  waitMs = (ACTIVE_SESSION_TTL_S + 5) * 1000,
): Promise<void> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const claimed = await redis.set(ACTIVE_SESSION_KEY, session, 'EX', ACTIVE_SESSION_TTL_S, 'NX');
    if (claimed === 'OK' || (await redis.get(ACTIVE_SESSION_KEY)) === session) return;
    if (Date.now() >= deadline)
      throw new Error('another dispatcher session is live on this Redis — refusing to start');
    log.warn({ session }, 'another dispatcher session holds the marker — waiting for it to lapse');
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}

const RELEASE_SESSION_LUA = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0
`;
const REFRESH_SESSION_LUA = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('EXPIRE', KEYS[1], ARGV[2]) end
return 0
`;

export async function refreshDispatcherSession(redis: Redis, session: string): Promise<boolean> {
  return (
    (await redis.eval(
      REFRESH_SESSION_LUA,
      1,
      ACTIVE_SESSION_KEY,
      session,
      ACTIVE_SESSION_TTL_S,
    )) === 1
  );
}

export async function releaseDispatcherSession(redis: Redis, session: string): Promise<void> {
  await redis.eval(RELEASE_SESSION_LUA, 1, ACTIVE_SESSION_KEY, session);
}
