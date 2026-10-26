import {
  cleanupComparisonReplay,
  cleanupUnusedWorkflowArchive,
  type DbTransaction,
  schema,
} from '@aivastra/db';
import { keys } from '@aivastra/storage';
import { and, asc, eq, gt, inArray, isNotNull, lt, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { getComparisonSettings } from './settings.js';

const DAY_MS = 86_400_000;
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
// Bounds one tick; the next hourly tick continues. Deletion talks to object storage,
// so this keeps a large backlog from pinning the process.
const DELETE_BATCH = 200;
const ARCHIVE_BATCH = 200;
// A row in one of these is finished with its replay job, so once it is retentionDays
// old (by last change) the job and its output can go. EXPIRED/UNSUPPORTED rows usually have no replay job at all.
const TERMINAL_ROW_STATUSES = ['COMPLETED', 'FAILED', 'CANCELLED', 'UNSUPPORTED', 'EXPIRED'];
const DISPATCHER_LOCK = sql`select pg_advisory_xact_lock(hashtextextended('workflow-comparison:dispatcher', 0))`;

export type RetentionResult = { expired: number; deleted: number };

// Stable ID keysets advance even when a whole batch is pinned or storage fails.
// Per-process recovery cursors are hints only; locks/rechecks provide correctness.
const deleteCursors = new WeakMap<FastifyInstance, string>();
const expiredCursors = new WeakMap<FastifyInstance, string>();
const archiveCursors = new WeakMap<FastifyInstance, string>();

async function releaseVersions(
  app: FastifyInstance,
  versions: { templateId: string; templateVersion: number }[],
): Promise<void> {
  const seen = new Set<string>();
  for (const v of versions) {
    const key = `${v.templateId}:${v.templateVersion}`;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      await cleanupUnusedWorkflowArchive(app.db, v.templateId, v.templateVersion);
    } catch (err) {
      app.log.error({ err, ...v }, 'comparison archive cleanup failed');
    }
  }
}

/**
 * Hourly sweep. Runs whether or not the feature is enabled: retention is a privacy
 * obligation, not a toggle.
 */
export async function runRetentionTick(app: FastifyInstance): Promise<RetentionResult> {
  const { retentionDays } = await getComparisonSettings(app);
  const cutoff = new Date(Date.now() - retentionDays * DAY_MS);

  // Backlog that waited past retention is dropped rather than run on a stale
  // template. Serialized with dispatch, which moves COLLECTED rows to QUEUED.
  const expired = await app.db.transaction(async (tx) => {
    await tx.execute(DISPATCHER_LOCK);
    return tx
      .update(schema.workflowComparisons)
      .set({
        status: 'EXPIRED',
        personKey: null,
        garmentKey: null,
        unsupportedReason: 'RETENTION_EXPIRED',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.workflowComparisons.status, 'COLLECTED'),
          lt(schema.workflowComparisons.createdAt, cutoff),
        ),
      )
      .returning({
        id: schema.workflowComparisons.id,
        templateId: schema.workflowComparisons.templateId,
        templateVersion: schema.workflowComparisons.templateVersion,
      });
  });

  const immediate = and(
    eq(schema.workflowComparisons.status, 'EXPIRED'),
    isNotNull(schema.workflowComparisons.generalJobId),
  );
  const ordinary = and(
    inArray(schema.workflowComparisons.status, TERMINAL_ROW_STATUSES),
    lt(schema.workflowComparisons.updatedAt, cutoff),
    or(
      sql`${schema.workflowComparisons.status} <> 'EXPIRED'`,
      sql`${schema.workflowComparisons.generalJobId} is null`,
    ),
  );
  const batch = async (candidate: typeof immediate, cursors: WeakMap<FastifyInstance, string>) => {
    const select = (cursor?: string) =>
      app.db
        .select()
        .from(schema.workflowComparisons)
        .where(and(candidate, cursor ? gt(schema.workflowComparisons.id, cursor) : undefined))
        .orderBy(asc(schema.workflowComparisons.id))
        .limit(DELETE_BATCH);
    let rows = await select(cursors.get(app));
    if (!rows.length && cursors.has(app)) rows = await select();
    if (rows.length === DELETE_BATCH) cursors.set(app, rows[rows.length - 1].id);
    else cursors.delete(app);
    return rows;
  };
  // Privacy obligations have their own fair bounded pass; an ordinary retention
  // backlog must never defer a fresh erasure merely because its ID sorts later.
  const privacy = await batch(immediate, expiredCursors);
  const terminal = await batch(ordinary, deleteCursors);
  const finished = [...new Map([...privacy, ...terminal].map((row) => [row.id, row])).values()];
  let deleted = 0;
  for (const row of finished) {
    try {
      const result = await cleanupComparisonReplay({
        db: app.db,
        withAdvisoryLock: app.withAdvisoryLock,
        comparisonId: row.id,
        io: {
          deleteObject: (key) => app.storage.deleteObject(key),
          replayOutputKeys: (jobId) => [
            keys.output(jobId, 'png'),
            keys.output(jobId, 'webp'),
            keys.outputThumb(jobId),
          ],
        },
        eligible: (fresh) =>
          (fresh.status === 'EXPIRED' && fresh.generalJobId !== null) ||
          (TERMINAL_ROW_STATUSES.includes(fresh.status) && fresh.updatedAt < cutoff),
      });
      if (result.deleted) deleted++;
      else if (!result.complete && !result.busy)
        app.log.warn(
          { comparisonId: row.id, jobId: row.generalJobId },
          'comparison cleanup skipped an unsafe replay link',
        );
    } catch (err) {
      app.log.error(
        { err, comparisonId: row.id, jobId: row.generalJobId },
        'comparison output delete failed',
      );
    }
  }
  // Immediate exact-version release is independent of the recovery batch cursor.
  await releaseVersions(app, [...expired, ...finished]);

  await releaseUnusedArchives(app);
  return { expired: expired.length, deleted };
}

/**
 * Drops any archived template version nothing references any more. Expiry and
 * cancellation free versions, and a crash between the commit and a targeted cleanup
 * would otherwise leave a permanent "previous version still draining" conflict on
 * the next template replace. The helper takes the template row lock and rechecks
 * jobs and comparisons, so it cannot delete a version still needed.
 */
export async function releaseUnusedArchives(app: FastifyInstance): Promise<void> {
  const selectBatch = (cursor?: string) =>
    app.db
      .select()
      .from(schema.workflowTemplateArchives)
      .where(cursor ? gt(schema.workflowTemplateArchives.id, cursor) : undefined)
      .orderBy(asc(schema.workflowTemplateArchives.id))
      .limit(ARCHIVE_BATCH);
  let archives = await selectBatch(archiveCursors.get(app));
  if (!archives.length && archiveCursors.has(app)) archives = await selectBatch();
  if (archives.length === ARCHIVE_BATCH) archiveCursors.set(app, archives[archives.length - 1].id);
  else archiveCursors.delete(app);
  await releaseVersions(
    app,
    archives.map((a) => ({ templateId: a.workflowTemplateId, templateVersion: a.version })),
  );
}

/**
 * Cancels comparisons whose replay job has not started. A job already running
 * always finishes. `audit` runs inside the same transaction as the cancellation so
 * an audit failure rolls the cancel back.
 *
 * Replay jobs cost nothing, so this deliberately does not go through the admin job
 * cancel route: that path refunds credits and notifies shoppers, none of which
 * applies here. The conditional UPDATE is the fence — a job that moved past QUEUED
 * between the select and the update is left alone.
 */
export async function cancelQueuedComparisons(
  app: FastifyInstance,
  audit?: (tx: DbTransaction, result: { cancelled: number }) => Promise<void>,
): Promise<{ cancelled: number }> {
  const versions: { templateId: string; templateVersion: number }[] = [];
  const result = await app.db.transaction(async (tx) => {
    await tx.execute(DISPATCHER_LOCK);
    const queued = await tx
      .select({
        jobId: schema.workflowComparisons.generalJobId,
        templateId: schema.workflowComparisons.templateId,
        templateVersion: schema.workflowComparisons.templateVersion,
      })
      .from(schema.workflowComparisons)
      .innerJoin(schema.jobs, eq(schema.jobs.id, schema.workflowComparisons.generalJobId))
      .where(
        and(
          eq(schema.workflowComparisons.status, 'QUEUED'),
          eq(schema.jobs.status, 'QUEUED'),
          eq(schema.jobs.source, 'comparison'),
        ),
      );
    const ids = queued.flatMap((q) => (q.jobId ? [q.jobId] : []));
    if (ids.length === 0) {
      const none = { cancelled: 0 };
      if (audit) await audit(tx, none);
      return none;
    }
    const cancelledJobs = await tx
      .update(schema.jobs)
      .set({ status: 'CANCELLED', errorCode: 'ADMIN_CANCEL', completedAt: new Date() })
      .where(
        and(
          inArray(schema.jobs.id, ids),
          eq(schema.jobs.status, 'QUEUED'),
          eq(schema.jobs.source, 'comparison'),
        ),
      )
      .returning({ id: schema.jobs.id });
    const cancelledIds = cancelledJobs.map((j) => j.id);
    versions.push(...queued.filter((q) => q.jobId && cancelledIds.includes(q.jobId)));
    if (cancelledIds.length > 0) {
      await tx
        .update(schema.workflowComparisons)
        .set({ status: 'CANCELLED', updatedAt: new Date() })
        .where(
          and(
            inArray(schema.workflowComparisons.generalJobId, cancelledIds),
            eq(schema.workflowComparisons.status, 'QUEUED'),
          ),
        );
    }
    const out = { cancelled: cancelledIds.length };
    if (audit) await audit(tx, out);
    return out;
  });
  // Cancelled rows no longer pin their template version.
  if (result.cancelled > 0) await releaseVersions(app, versions);
  return result;
}

export function startComparisonRetention(
  app: FastifyInstance,
  intervalMs: number = SWEEP_INTERVAL_MS,
): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) {
      app.log.warn('comparison retention tick still running — skipping this interval');
      return;
    }
    running = true;
    void runRetentionTick(app)
      .catch((err) => app.log.error({ err }, 'comparison retention tick failed'))
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  return () => clearInterval(timer);
}
