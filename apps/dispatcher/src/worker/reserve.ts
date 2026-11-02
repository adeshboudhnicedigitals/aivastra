import type { DB } from '@aivastra/db';
import type { Logger } from '@aivastra/logger';
import type { Redis } from 'ioredis';
import type { OwnerToken } from '../job/ownership.js';
import { bindAttemptWorker, prepareAttempt } from '../job/submission.js';
import { releaseWorker, reservationToken, transientReservationToken } from './registry.js';
import { reconcileReservation } from './reservation-reconciler.js';
import type { ClaimedWorker } from './selector.js';

export interface Reservation {
  worker: ClaimedWorker;
  attemptId: string;
  clientId: string;
  token: string;
}

interface ReserveArgs {
  db: DB;
  redis: Redis;
  /** Paid-Comfy jobs have one; classify has none and gets a transient token. */
  owner?: OwnerToken;
  jobId?: string;
  requestId?: string;
  phase: 'main' | 'mannequin' | 'classify';
  /** Claims a worker with the given token, or null when none is eligible. */
  select: (token: string) => Promise<ClaimedWorker | null>;
  log: Logger;
  /**
   * Runs once the worker is bound to the attempt and before anything is uploaded or sent. If it
   * throws (the job finished while it waited, ownership was lost) the hold is released.
   */
  onBound?: () => Promise<void>;
}

/**
 * The only way a processor takes a worker: allocate the PREPARING attempt first, claim with a
 * token that names it, then persist the worker on the attempt before any upload or POST. A
 * restart can then rebuild exactly which attempt holds which worker.
 */
export async function reserveWorker(args: ReserveArgs): Promise<Reservation | null> {
  const { db, redis, owner, jobId, requestId, phase, log } = args;
  const attempt = await prepareAttempt({ db, owner, jobId, requestId, phase });
  const token = owner
    ? reservationToken({
        session: owner.session,
        generation: owner.generation,
        attemptId: attempt.attemptId,
      })
    : transientReservationToken();
  const worker = await args.select(token);
  if (!worker) return null;
  try {
    await bindAttemptWorker({
      db,
      owner,
      jobId,
      requestId,
      phase,
      attemptId: attempt.attemptId,
      worker,
    });
    await args.onBound?.();
  } catch (err) {
    // Nothing was uploaded or sent, so the hold has no remote work behind it.
    await releaseWorker(redis, worker.id, token, log);
    throw err;
  }
  return { worker, attemptId: attempt.attemptId, clientId: attempt.clientId, token };
}

/**
 * Releases the caller's own hold on the way out. A paid hold is freed only on evidence: no
 * submission happened, or the prompt is shown to have ended. Otherwise (a SUBMITTING attempt,
 * or a prompt still running or unreadable) it stays, and the scheduled reconciler frees it once
 * the owner is retired and the prompt is gone. Classify's transient token is always freed.
 */
export async function releaseReservation(
  args: { db: DB; redis: Redis; uncertainCheckMs: number; log: Logger },
  reservation: Reservation,
): Promise<'released' | 'held'> {
  const { redis, log } = args;
  const { worker, token } = reservation;
  try {
    const outcome = await reconcileReservation(
      { db: args.db, redis, log, uncertainCheckMs: args.uncertainCheckMs },
      worker.id,
      token,
      'owner',
    );
    if (outcome === 'released' || outcome === 'cleared_stale' || outcome === 'skipped_transient') {
      if (outcome === 'skipped_transient') await releaseWorker(redis, worker.id, token, log);
      return 'released';
    }
    // Quarantined/held/replaced: the hold is not this handler's to free.
    log.info(
      {
        stage: 'reservation_retained',
        workerId: worker.id,
        attemptId: reservation.attemptId,
        outcome,
      },
      'worker reservation retained for reconciliation',
    );
    return 'held';
  } catch (err) {
    // DB or Redis trouble fails closed: a held worker is recovered by the reconciler, a freed
    // one cannot be taken back.
    log.error({ err, workerId: worker.id }, 'reservation release could not be decided — held');
    return 'held';
  }
}
