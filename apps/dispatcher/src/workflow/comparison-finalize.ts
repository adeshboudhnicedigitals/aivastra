import {
  canFinalizeComparisonReplay,
  comparisonOutputLockKey,
  deleteComparisonOutputObjects,
  schema,
  type WithDbLock,
} from '@aivastra/db';
import { keys } from '@aivastra/storage';
import { eq } from 'drizzle-orm';
import { settleAndPublish } from '../job/settlement.js';
import { type FinalizeOutputOpts, finalizeOutput } from './finalize.js';

/** Hold one session lock across preflight, all object writes, and completion. */
export async function finalizeComparisonOutput(
  opts: FinalizeOutputOpts,
  withAdvisoryLock: WithDbLock | undefined,
): Promise<{ completed: boolean }> {
  if (!withAdvisoryLock) throw new Error('comparison output lock unavailable');
  const result = await withAdvisoryLock(comparisonOutputLockKey(opts.jobId), async (db) => {
    const cleanup = async () => {
      // Persist the obligation first, even when a PUT succeeded but its response
      // or the completion transaction failed. Retention retries it immediately.
      await db
        .update(schema.workflowComparisons)
        .set({
          status: 'EXPIRED',
          personKey: null,
          garmentKey: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.workflowComparisons.generalJobId, opts.jobId));
      await deleteComparisonOutputObjects(db, opts.jobId, {
        deleteObject: (key) => opts.storage.deleteObject(key),
        replayOutputKeys: (id) => [
          keys.output(id, 'png'),
          keys.output(id, 'webp'),
          keys.outputThumb(id),
        ],
      });
    };
    if (!(await canFinalizeComparisonReplay(db, opts.jobId))) {
      const [current] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, opts.jobId));
      if (current && current.source !== 'comparison') return { completed: false };
      // A second worker may have loaded QUEUED before the first one completed.
      // Its late finalizer must leave the successfully committed result alone.
      if (current?.status === 'COMPLETED') return { completed: false };
      // A stale delivery still needs a terminal job state before it is ACKed.
      // Missing/expired links cannot grant permission to upload shared inputs.
      // Fenced like every terminal write: a job a stale delivery finds already FAILED or
      // CANCELLED is left as it is, and a stale owner cannot cancel a job it no longer owns.
      // Comparison jobs are created with credits_charged = 0, so there is nothing to refund.
      await settleAndPublish(
        { db, pub: opts.pub, log: opts.jobLog },
        { owner: opts.owner },
        { kind: 'cancelled', errorCode: 'COMPARISON_INVALID' },
        { userId: opts.userId },
      );
      await cleanup();
      return { completed: false };
    }
    let finalized: Awaited<ReturnType<typeof finalizeOutput>>;
    try {
      finalized = await finalizeOutput({ ...opts, db });
    } catch (err) {
      try {
        await cleanup();
      } catch (cleanupError) {
        throw new AggregateError([err, cleanupError], 'comparison finalization and cleanup failed');
      }
      throw err;
    }
    if (!finalized.completed) await cleanup();
    return finalized;
  });
  // Let the existing failure handler durably requeue before ACK. Contention is
  // not cancellation: dropping this delivery could strand a live UPLOADING job.
  if (!result) throw new Error('COMPARISON_OUTPUT_BUSY');
  return result;
}
