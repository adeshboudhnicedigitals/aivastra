import { type DB, type DbTransaction, schema } from '@aivastra/db';
import type { Logger } from '@aivastra/logger';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { ComfyPromptHttpError, submitPrompt } from '../comfyui/client.js';
import { assertOwnerInTransaction, type OwnerToken } from './ownership.js';

interface SubmissionOptions {
  db: DB;
  /** Present for every paid-Comfy submit; classify has no owner. */
  owner?: OwnerToken;
  jobId?: string;
  requestId?: string;
  phase: 'main' | 'mannequin' | 'classify';
  worker: { id: string; url: string; apiKey: string };
  prompt: Record<string, unknown>;
  contract: Record<string, unknown>;
  log: Logger;
}

/** Commit identity and the patched prompt before the only HTTP send. */
export async function submitRecordedPhase(opts: SubmissionOptions): Promise<{
  attemptId: string;
  clientId: string;
  promptId: string;
}> {
  const { db, jobId, requestId, phase, worker, prompt, log } = opts;
  if (Boolean(jobId) === Boolean(requestId))
    throw new Error('submission requires exactly one parent');
  const parentId = jobId ?? requestId;
  if (!parentId) throw new Error('submission parent is empty');
  const startedAt = performance.now();
  const attempt = await db.transaction(async (tx) => {
    if (jobId) {
      const [job] = await tx
        .select({ id: schema.jobs.id })
        .from(schema.jobs)
        .where(eq(schema.jobs.id, jobId))
        .for('update');
      if (!job) throw new Error('submission job not found');
      // jobs is already locked above, matching the lock order everywhere else.
      if (opts.owner) await assertOwnerInTransaction(tx, opts.owner, `submit:${phase}`);
    } else {
      // Classify has no charged jobs row and records its result after execution.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`comfy-classify:${requestId}`}, 0))`,
      );
    }
    const [previous] = await tx
      .select({
        max: sql<number>`coalesce(max(${schema.executionAttempts.attemptNo}), 0)::integer`,
      })
      .from(schema.executionAttempts)
      .where(
        jobId
          ? eq(schema.executionAttempts.jobId, jobId)
          : eq(schema.executionAttempts.requestId, parentId),
      );
    const attemptNo = (previous?.max ?? 0) + 1;
    const clientId = jobId
      ? `av:${jobId}:${attemptNo}:${phase}`
      : `av:classify:${requestId}:${attemptNo}`;
    const [row] = await tx
      .insert(schema.executionAttempts)
      .values({
        jobId: jobId ?? null,
        requestId: requestId ?? null,
        attemptNo,
        phase,
        clientId,
        state: 'SUBMITTING',
        workerId: worker.id,
        workerUrl: worker.url,
        contract: { ...opts.contract, version: 1, prompt },
      })
      .returning({ id: schema.executionAttempts.id, clientId: schema.executionAttempts.clientId });
    if (!row) throw new Error('submission intent insert returned no row');
    // The only attempt allowed to publish is the newest one under the current owner.
    if (opts.owner)
      await tx
        .update(schema.dispatcherJobControl)
        .set({ activeAttemptId: row.id })
        .where(
          and(
            eq(schema.dispatcherJobControl.jobId, opts.owner.jobId),
            eq(schema.dispatcherJobControl.ownerSession, opts.owner.session),
          ),
        );
    if (jobId)
      await tx.insert(schema.jobEvents).values({
        jobId,
        eventType: 'COMFY_SUBMIT_STARTED',
        payload: { attemptId: row.id, clientId, phase, workerId: worker.id },
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
 * Telemetry only; the caller's existing transaction still decides the job.
 *
 * Phase A only: the attempt row is a record, so it runs in a savepoint and a
 * failure is logged instead of rolling back the terminal transition. Phase B2
 * makes the attempt authoritative for settlement; remove the savepoint then.
 */
export async function recordSubmissionOutcome(
  tx: DB | DbTransaction,
  jobId: string,
  status: string,
  log: Logger,
): Promise<void> {
  if (!['COMPLETED', 'FAILED', 'CANCELLED'].includes(status)) return;
  try {
    await tx.transaction(async (sp) => {
      await sp
        .update(schema.executionAttempts)
        .set({
          state: status === 'COMPLETED' ? 'SUCCEEDED' : 'FAILED',
          updatedAt: new Date(),
          // Failure/cancel/retry may leave a remote prompt alive. Do not certify it ended.
          ...(status === 'COMPLETED' ? { resolvedAt: new Date() } : {}),
        })
        .where(
          and(
            eq(
              schema.executionAttempts.id,
              sql`(select id from execution_attempts where job_id = ${jobId} order by attempt_no desc limit 1)`,
            ),
            inArray(schema.executionAttempts.state, ['ACCEPTED', 'OUTPUT_READY']),
          ),
        );
    });
  } catch (err) {
    log.warn({ err, jobId, status }, 'could not record submission outcome');
  }
}
