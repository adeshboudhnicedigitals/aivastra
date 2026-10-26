import { and, eq } from 'drizzle-orm';
import type { createDb, DB } from './index.js';
import * as schema from './schema/index.js';

export type WithDbLock = ReturnType<typeof createDb>['withAdvisoryLock'];
export type ComparisonObjectIO = {
  deleteObject(key: string): Promise<void>;
  replayOutputKeys(jobId: string): string[];
};
export const comparisonOutputLockKey = (jobId: string): string =>
  `workflow-comparison:output:${jobId}`;

/** Source-row-serialized privacy fence shared by API erasure and dispatcher retention. */
export async function invalidateComparisonsForSources(
  db: DB,
  sourceJobIds: string[],
): Promise<Array<{ id: string; sourceJobId: string; generalJobId: string | null }>> {
  return db.transaction(async (tx) => {
    const links: Array<{ id: string; sourceJobId: string; generalJobId: string | null }> = [];
    for (const sourceJobId of [...new Set(sourceJobIds)].sort()) {
      const [source] = await tx
        .select({ id: schema.jobs.id })
        .from(schema.jobs)
        .where(eq(schema.jobs.id, sourceJobId))
        .for('update');
      if (!source) continue;
      const [input] = await tx
        .select({ params: schema.jobInputs.params })
        .from(schema.jobInputs)
        .where(eq(schema.jobInputs.jobId, sourceJobId))
        .for('update');
      if (input) {
        let params: Record<string, unknown> = {};
        if (input.params && typeof input.params === 'object' && !Array.isArray(input.params)) {
          params = input.params as Record<string, unknown>;
        } else if (typeof input.params === 'string') {
          try {
            const parsed: unknown = JSON.parse(input.params);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
              params = parsed as Record<string, unknown>;
          } catch {
            // Malformed legacy params are replaced by a durable erasure tombstone.
          }
        }
        await tx
          .update(schema.jobInputs)
          .set({ params: { ...params, comparisonErased: true } })
          .where(eq(schema.jobInputs.jobId, sourceJobId));
      }
      const changed = await tx
        .update(schema.workflowComparisons)
        .set({
          status: 'EXPIRED',
          personKey: null,
          garmentKey: null,
          unsupportedReason: 'SOURCE_ERASED',
          updatedAt: new Date(),
        })
        .where(eq(schema.workflowComparisons.sourceJobId, sourceJobId))
        .returning({
          id: schema.workflowComparisons.id,
          sourceJobId: schema.workflowComparisons.sourceJobId,
          generalJobId: schema.workflowComparisons.generalJobId,
        });
      links.push(...changed);
    }
    return links;
  });
}

/** Caller holds comparisonOutputLockKey through every PUT/delete and DB commit. */
export async function deleteComparisonOutputObjects(
  db: DB,
  jobId: string,
  io: ComparisonObjectIO,
): Promise<void> {
  const outputs = await db
    .select()
    .from(schema.jobOutputs)
    .where(eq(schema.jobOutputs.jobId, jobId));
  const keys = new Set(io.replayOutputKeys(jobId));
  for (const output of outputs) {
    if (output.resultKey) keys.add(output.resultKey);
    if (output.thumbnailKey) keys.add(output.thumbnailKey);
  }
  // Attempt every variant, including uploads which never got an output row.
  // Throw only after the pass: callers must retain both durable cleanup roots.
  const failures: unknown[] = [];
  for (const key of keys) {
    try {
      await io.deleteObject(key);
    } catch (err) {
      failures.push(err);
    }
  }
  if (failures.length) throw new AggregateError(failures, 'comparison output deletion incomplete');
}

/** Fresh recheck inside the output lock, immediately before the first PUT. */
export async function canFinalizeComparisonReplay(db: DB, jobId: string): Promise<boolean> {
  const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
  if (
    job?.source !== 'comparison' ||
    !['QUEUED', 'PREPROCESSING', 'GENERATING', 'UPLOADING'].includes(job.status)
  )
    return false;
  const [link] = await db
    .select()
    .from(schema.workflowComparisons)
    .where(eq(schema.workflowComparisons.generalJobId, jobId));
  if (!link || !['QUEUED', 'RUNNING'].includes(link.status)) return false;
  const [source] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, link.sourceJobId));
  const [input] = await db
    .select()
    .from(schema.jobInputs)
    .where(eq(schema.jobInputs.jobId, link.sourceJobId));
  return (
    source?.status === 'COMPLETED' &&
    source.source !== 'comparison' &&
    Boolean(input) &&
    (input?.params as Record<string, unknown> | null)?.comparisonErased !== true
  );
}

type ComparisonRow = typeof schema.workflowComparisons.$inferSelect;
export type ComparisonCleanupResult = {
  complete: boolean;
  deleted: boolean;
  busy: boolean;
};

/**
 * Output-only cleanup shared by retention and source erasure. Never touches input
 * keys. A privacy caller first invalidates its source and marks links EXPIRED;
 * ordinary retention supplies an eligibility predicate, rechecked under the lock.
 */
export async function cleanupComparisonReplay(opts: {
  db: DB;
  withAdvisoryLock: WithDbLock;
  comparisonId: string;
  io: ComparisonObjectIO;
  eligible?: (row: ComparisonRow) => boolean;
}): Promise<ComparisonCleanupResult> {
  const { db, comparisonId, io } = opts;
  const [snapshot] = await db
    .select()
    .from(schema.workflowComparisons)
    .where(eq(schema.workflowComparisons.id, comparisonId));
  if (!snapshot) return { complete: true, deleted: false, busy: false };
  const cleanup = async (scoped: DB): Promise<ComparisonCleanupResult> => {
    const ready = await scoped.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.workflowComparisons)
        .where(eq(schema.workflowComparisons.id, comparisonId))
        .for('update');
      if (!row) return 'missing' as const;
      if (row.generalJobId !== snapshot.generalJobId || (opts.eligible && !opts.eligible(row)))
        return 'unsafe' as const;
      if (row.generalJobId) {
        const [job] = await tx
          .select()
          .from(schema.jobs)
          .where(eq(schema.jobs.id, row.generalJobId))
          .for('update');
        // An EXPIRED link is a privacy obligation even while its GPU work runs.
        if (
          job &&
          (job.source !== 'comparison' ||
            (row.status !== 'EXPIRED' &&
              !['COMPLETED', 'FAILED', 'CANCELLED'].includes(job.status)))
        )
          return 'unsafe' as const;
        await tx
          .update(schema.jobs)
          .set({ status: 'CANCELLED', errorCode: 'COMPARISON_CLEANUP', completedAt: new Date() })
          .where(and(eq(schema.jobs.id, row.generalJobId), eq(schema.jobs.source, 'comparison')));
        // Commit the retry obligation before storage I/O. A crash or failure must
        // never restart the retention clock or discard the replay ID.
        await tx
          .update(schema.workflowComparisons)
          .set({ status: 'EXPIRED', personKey: null, garmentKey: null, updatedAt: new Date() })
          .where(eq(schema.workflowComparisons.id, comparisonId));
      } else {
        await tx
          .delete(schema.workflowComparisons)
          .where(eq(schema.workflowComparisons.id, comparisonId));
      }
      return 'ready' as const;
    });
    if (ready !== 'ready') return { complete: ready === 'missing', deleted: false, busy: false };
    const replayId = snapshot.generalJobId;
    if (replayId) {
      await deleteComparisonOutputObjects(scoped, replayId, io);
      await scoped.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(schema.workflowComparisons)
          .where(eq(schema.workflowComparisons.id, comparisonId))
          .for('update');
        if (!row || row.generalJobId !== replayId || row.status !== 'EXPIRED')
          throw new Error('comparison cleanup link changed');
        await tx
          .delete(schema.jobs)
          .where(and(eq(schema.jobs.id, replayId), eq(schema.jobs.source, 'comparison')));
        await tx
          .delete(schema.workflowComparisons)
          .where(eq(schema.workflowComparisons.id, comparisonId));
      });
    }
    return { complete: true, deleted: true, busy: false };
  };
  if (!snapshot.generalJobId) return cleanup(db);
  const result = await opts.withAdvisoryLock(
    comparisonOutputLockKey(snapshot.generalJobId),
    cleanup,
  );
  return result ?? { complete: false, deleted: false, busy: true };
}
