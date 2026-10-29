import { type DB, type DbTransaction, schema } from '@aivastra/db';
import type { Logger } from '@aivastra/logger';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { ComfyPromptHttpError, submitPrompt } from '../comfyui/client.js';
import { assertOwnerInTransaction, type OwnerToken } from './ownership.js';

interface AttemptParent {
  db: DB;
  /** Present for every paid-Comfy attempt; classify has no owner. */
  owner?: OwnerToken;
  jobId?: string;
  requestId?: string;
  phase: 'main' | 'mannequin' | 'classify';
}

interface SubmissionOptions extends AttemptParent {
  /** The PREPARING attempt `prepareAttempt` allocated before the worker was claimed. */
  attemptId: string;
  worker: { id: string; url: string; apiKey: string };
  prompt: Record<string, unknown>;
  contract: Record<string, unknown>;
  log: Logger;
}

export interface PreparedAttempt {
  attemptId: string;
  clientId: string;
  /** The owner generation the attempt belongs to; classify has none. */
  generation: bigint | null;
}

function parentOf(opts: AttemptParent): string {
  if (Boolean(opts.jobId) === Boolean(opts.requestId))
    throw new Error('submission requires exactly one parent');
  const parentId = opts.jobId ?? opts.requestId;
  if (!parentId) throw new Error('submission parent is empty');
  return parentId;
}

/**
 * Allocates the PREPARING attempt a worker reservation is keyed to, before any worker is
 * claimed (plan §4: the token names the attempt). A PREPARING attempt that never reached a
 * worker is reused rather than re-created: a job waiting for capacity retries every 10 s and
 * must not mint a row per retry.
 */
export async function prepareAttempt(opts: AttemptParent): Promise<PreparedAttempt> {
  const { db, jobId, requestId, phase } = opts;
  const parentId = parentOf(opts);
  return db.transaction(async (tx) => {
    if (jobId) {
      const [job] = await tx
        .select({ id: schema.jobs.id })
        .from(schema.jobs)
        .where(eq(schema.jobs.id, jobId))
        .for('update');
      if (!job) throw new Error('submission job not found');
      // jobs is already locked above, matching the lock order everywhere else.
      if (opts.owner) await assertOwnerInTransaction(tx, opts.owner, `prepare:${phase}`);
    } else {
      // Classify has no charged jobs row and records its result after execution.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`comfy-classify:${requestId}`}, 0))`,
      );
    }
    const parentFilter = jobId
      ? eq(schema.executionAttempts.jobId, jobId)
      : eq(schema.executionAttempts.requestId, parentId);
    const [unused] = await tx
      .select({ id: schema.executionAttempts.id, clientId: schema.executionAttempts.clientId })
      .from(schema.executionAttempts)
      .where(
        and(
          parentFilter,
          eq(schema.executionAttempts.phase, phase),
          eq(schema.executionAttempts.state, 'PREPARING'),
          isNull(schema.executionAttempts.workerId),
        ),
      )
      .limit(1);
    let attempt = unused;
    if (!attempt) {
      const [previous] = await tx
        .select({
          max: sql<number>`coalesce(max(${schema.executionAttempts.attemptNo}), 0)::integer`,
        })
        .from(schema.executionAttempts)
        .where(parentFilter);
      const attemptNo = (previous?.max ?? 0) + 1;
      const clientId = jobId
        ? `av:${jobId}:${attemptNo}:${phase}`
        : `av:classify:${requestId}:${attemptNo}`;
      [attempt] = await tx
        .insert(schema.executionAttempts)
        .values({
          jobId: jobId ?? null,
          requestId: requestId ?? null,
          attemptNo,
          phase,
          clientId,
          state: 'PREPARING',
          contract: { version: 1, kind: 'preparing' },
        })
        .returning({
          id: schema.executionAttempts.id,
          clientId: schema.executionAttempts.clientId,
        });
    }
    if (!attempt) throw new Error('attempt insert returned no row');
    // The only attempt allowed to publish is the newest one under the current owner.
    if (opts.owner)
      await tx
        .update(schema.dispatcherJobControl)
        .set({ activeAttemptId: attempt.id })
        .where(
          and(
            eq(schema.dispatcherJobControl.jobId, opts.owner.jobId),
            eq(schema.dispatcherJobControl.ownerSession, opts.owner.session),
          ),
        );
    return {
      attemptId: attempt.id,
      clientId: attempt.clientId,
      generation: opts.owner ? BigInt(opts.owner.generation) : null,
    };
  });
}

/**
 * Persists the claimed worker on the attempt under the ownership fence, before any upload or
 * POST, so a restart can rebuild the hold. A crash between the claim and this write has no
 * remote execution to protect.
 */
export async function bindAttemptWorker(
  opts: AttemptParent & {
    attemptId: string;
    worker: { id: string; url: string };
  },
): Promise<void> {
  const { db, jobId, attemptId, worker } = opts;
  await db.transaction(async (tx) => {
    if (jobId) {
      await tx
        .select({ id: schema.jobs.id })
        .from(schema.jobs)
        .where(eq(schema.jobs.id, jobId))
        .for('update');
      if (opts.owner) await assertOwnerInTransaction(tx, opts.owner, `bind:${opts.phase}`);
    }
    const bound = await tx
      .update(schema.executionAttempts)
      .set({ workerId: worker.id, workerUrl: worker.url, updatedAt: new Date() })
      .where(
        and(
          eq(schema.executionAttempts.id, attemptId),
          eq(schema.executionAttempts.state, 'PREPARING'),
          isNull(schema.executionAttempts.workerId),
        ),
      )
      .returning({ id: schema.executionAttempts.id });
    if (!bound.length) throw new Error('attempt is not an unbound PREPARING attempt');
  });
}

/** Commit identity and the patched prompt before the only HTTP send. */
export async function submitRecordedPhase(opts: SubmissionOptions): Promise<{
  attemptId: string;
  clientId: string;
  promptId: string;
}> {
  const { db, jobId, requestId, phase, worker, prompt, log } = opts;
  parentOf(opts);
  const startedAt = performance.now();
  const attempt = await db.transaction(async (tx) => {
    if (jobId) {
      await tx
        .select({ id: schema.jobs.id })
        .from(schema.jobs)
        .where(eq(schema.jobs.id, jobId))
        .for('update');
      if (opts.owner) await assertOwnerInTransaction(tx, opts.owner, `submit:${phase}`);
    } else {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`comfy-classify:${requestId}`}, 0))`,
      );
    }
    const [row] = await tx
      .update(schema.executionAttempts)
      .set({
        state: 'SUBMITTING',
        contract: { ...opts.contract, version: 1, prompt },
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.executionAttempts.id, opts.attemptId),
          eq(schema.executionAttempts.state, 'PREPARING'),
          // The worker was bound before uploads; submitting through another one would send
          // the prompt where the reservation does not protect it.
          eq(schema.executionAttempts.workerId, worker.id),
          jobId
            ? eq(schema.executionAttempts.jobId, jobId)
            : eq(schema.executionAttempts.requestId, requestId ?? ''),
        ),
      )
      .returning({ id: schema.executionAttempts.id, clientId: schema.executionAttempts.clientId });
    if (!row) throw new Error('submission attempt is not PREPARING on this worker');
    if (jobId)
      await tx.insert(schema.jobEvents).values({
        jobId,
        eventType: 'COMFY_SUBMIT_STARTED',
        payload: { attemptId: row.id, clientId: row.clientId, phase, workerId: worker.id },
      });
    return row;
  });
  log.info(
    {
      stage: 'submit_intent_commit',
      durationMs: performance.now() - startedAt,
      attemptId: attempt.id,
      clientId: attempt.clientId,
      phase,
    },
    'job stage timing',
  );

  // A transport failure after this point is ambiguous. Leave SUBMITTING intact if
  // either the response or receipt commit is lost; never repeat this intent.
  let promptId: string;
  try {
    ({ promptId } = await submitPrompt(worker.url, worker.apiKey, attempt.clientId, prompt, log));
  } catch (err) {
    if (isDefiniteRejection(err))
      await db
        .update(schema.executionAttempts)
        .set({ state: 'FAILED', updatedAt: new Date(), resolvedAt: new Date() })
        .where(
          and(
            eq(schema.executionAttempts.id, attempt.id),
            eq(schema.executionAttempts.state, 'SUBMITTING'),
          ),
        )
        .catch((updateErr) => {
          // Leaving SUBMITTING is the safe direction: it is only treated as uncertain.
          log.warn({ err: updateErr, attemptId: attempt.id }, 'could not record rejected submit');
        });
    throw err;
  }
  // The worker already accepted the prompt. Failing here would send the caller
  // into a retry that runs it a second time, so record the receipt best-effort.
  // The attempt stays SUBMITTING and a later reconciler finds it by client ID.
  await db
    .update(schema.executionAttempts)
    .set({ state: 'ACCEPTED', promptId, updatedAt: new Date() })
    .where(eq(schema.executionAttempts.id, attempt.id))
    .catch((err) => {
      log.warn(
        { err, attemptId: attempt.id, clientId: attempt.clientId },
        'could not record accepted prompt receipt',
      );
    });
  return { attemptId: attempt.id, clientId: attempt.clientId, promptId };
}

// Only ComfyUI's own validation answer proves nothing was queued. A 5xx or an
// edge-proxy 4xx may have reached the worker, so those stay uncertain.
function isDefiniteRejection(err: unknown): boolean {
  if (!(err instanceof ComfyPromptHttpError) || err.status !== 400) return false;
  try {
    const body: unknown = JSON.parse(err.body);
    return typeof body === 'object' && body !== null && ('error' in body || 'node_errors' in body);
  } catch {
    return false;
  }
}

/**
 * Records how the job's active attempt ended, inside the caller's transaction.
 *
 * The attempt row is authoritative for settlement (plan §3), so there is no savepoint: a
 * failed write rolls the whole settlement or yield back instead of being logged and lost.
 * It targets `control.active_attempt_id` rather than "latest by attempt_no", and verifies
 * the attempt belongs to this job. Only attempts that reached ACCEPTED or OUTPUT_READY move;
 * one still SUBMITTING stays so adoption can search for its prompt.
 */
export async function recordAttemptOutcome(
  tx: DB | DbTransaction,
  jobId: string,
  status: 'COMPLETED' | 'FAILED' | 'CANCELLED',
): Promise<void> {
  await tx
    .update(schema.executionAttempts)
    .set({
      state: status === 'COMPLETED' ? 'SUCCEEDED' : 'FAILED',
      updatedAt: new Date(),
      // Failure/cancel/retry may leave a remote prompt alive. Do not certify it ended.
      ...(status === 'COMPLETED' ? { resolvedAt: new Date() } : {}),
    })
    .where(
      and(
        eq(schema.executionAttempts.jobId, jobId),
        eq(
          schema.executionAttempts.id,
          sql`(select active_attempt_id from dispatcher_job_control where job_id = ${jobId})`,
        ),
        inArray(schema.executionAttempts.state, ['ACCEPTED', 'OUTPUT_READY']),
      ),
    );
}
