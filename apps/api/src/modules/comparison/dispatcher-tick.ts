import { schema } from '@aivastra/db';
import { and, asc, eq, inArray, lt, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { enqueueReplayJob, insertReplayJob, REPLAY_ENQUEUE_PENDING } from './create-replay-job.js';
import { getComparisonSettings } from './settings.js';
import { ensureComparisonSystemUser } from './system-user.js';

type DispatchResult = {
  dispatched: boolean;
  skipped: 'disabled' | 'busy' | 'no_worker' | 'empty' | null;
};
const ACTIVE_JOB_STATUSES = ['QUEUED', 'PREPROCESSING', 'GENERATING', 'UPLOADING'];
const ENQUEUE_RECOVERY_GRACE_MS = 120_000;
const WORKER_FRESHNESS_MS = 60_000;

export async function isInhouseWorkerIdle(app: FastifyInstance): Promise<boolean> {
  const workers = await app.db
    .select({ id: schema.workers.id, allowedJobTypes: schema.workers.allowedJobTypes })
    .from(schema.workers)
    .where(eq(schema.workers.isActive, true));
  for (const worker of workers) {
    if (!worker.allowedJobTypes.includes('inhouse')) continue;
    const raw = await app.redis.hget('worker:registry', worker.id);
    if (!raw) continue;
    let entry: { status?: unknown; lastSeen?: unknown; allowedJobTypes?: unknown };
    try {
      entry = JSON.parse(raw);
    } catch {
      continue;
    }
    if (
      entry?.status !== 'IDLE' ||
      typeof entry.lastSeen !== 'number' ||
      !Number.isFinite(entry.lastSeen) ||
      Date.now() - entry.lastSeen > WORKER_FRESHNESS_MS ||
      entry.lastSeen > Date.now() + WORKER_FRESHNESS_MS ||
      !Array.isArray(entry.allowedJobTypes) ||
      !entry.allowedJobTypes.includes('inhouse')
    )
      continue;
    if (await app.redis.exists(`worker:health:${worker.id}`)) return true;
  }
  return false;
}

function paramsObject(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return {};
    }
  }
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function missingObject(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.$metadata?.httpStatusCode === 404 || e?.name === 'NotFound' || e?.name === 'NoSuchKey';
}

export async function runDispatchTick(app: FastifyInstance): Promise<DispatchResult> {
  const decision = await app.db.transaction(async (tx) => {
    // The same transaction serializes the idle checks and replay/link inserts
    // across API processes. GPU work never holds this lock.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended('workflow-comparison:dispatcher', 0))`,
    );

    // A crash after the DB commit may leave an unconfirmed enqueue. Never XADD
    // again: the original command may have succeeded. CANCELLED fences a late
    // consumer that read QUEUED before recovery acquired the row lock.
    await tx
      .update(schema.jobs)
      .set({ status: 'CANCELLED', errorCode: 'ENQUEUE_UNCONFIRMED', completedAt: new Date() })
      .where(
        and(
          eq(schema.jobs.source, 'comparison'),
          eq(schema.jobs.status, 'QUEUED'),
          eq(schema.jobs.errorCode, REPLAY_ENQUEUE_PENDING),
          lt(schema.jobs.createdAt, new Date(Date.now() - ENQUEUE_RECOVERY_GRACE_MS)),
        ),
      );
    const linked = await tx
      .select({
        id: schema.workflowComparisons.id,
        jobStatus: schema.jobs.status,
      })
      .from(schema.workflowComparisons)
      .leftJoin(schema.jobs, eq(schema.jobs.id, schema.workflowComparisons.generalJobId))
      .where(inArray(schema.workflowComparisons.status, ['QUEUED', 'RUNNING']));
    for (const row of linked) {
      // general_job_id is SET NULL on replay deletion. Orphaned active links
      // are terminal bookkeeping failures, never a permanent dispatch gate.
      const status =
        row.jobStatus === null
          ? 'FAILED'
          : ['PREPROCESSING', 'GENERATING', 'UPLOADING'].includes(row.jobStatus)
            ? 'RUNNING'
            : ['COMPLETED', 'FAILED', 'CANCELLED'].includes(row.jobStatus)
              ? row.jobStatus
              : null;
      if (status)
        await tx
          .update(schema.workflowComparisons)
          .set({
            status,
            ...(row.jobStatus === null ? { unsupportedReason: 'REPLAY_MISSING' } : {}),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.workflowComparisons.id, row.id),
              inArray(schema.workflowComparisons.status, ['QUEUED', 'RUNNING']),
            ),
          );
    }
    // Reconciliation and crash recovery deliberately run with the toggle off.
    if ((await getComparisonSettings(app)).enabled !== true)
      return { dispatched: false, skipped: 'disabled' } as const;
    const [inflight] = await tx
      .select({ id: schema.workflowComparisons.id })
      .from(schema.workflowComparisons)
      .where(inArray(schema.workflowComparisons.status, ['QUEUED', 'RUNNING']))
      .limit(1);
    const [manual] = await tx
      .select({ id: schema.jobs.id })
      .from(schema.jobs)
      .where(
        and(
          eq(schema.jobs.queueStream, 'inhouse'),
          inArray(schema.jobs.status, ACTIVE_JOB_STATUSES),
          sql`${schema.jobs.source} is distinct from 'comparison'`,
        ),
      )
      .limit(1);
    if (inflight || manual) return { dispatched: false, skipped: 'busy' } as const;
    if (!(await isInhouseWorkerIdle(app)))
      return { dispatched: false, skipped: 'no_worker' } as const;

    const [candidate] = await tx
      .select()
      .from(schema.workflowComparisons)
      .where(eq(schema.workflowComparisons.status, 'COLLECTED'))
      .orderBy(asc(schema.workflowComparisons.createdAt), asc(schema.workflowComparisons.id))
      .limit(1);
    if (!candidate) return { dispatched: false, skipped: 'empty' } as const;
    // Privacy invalidation takes this source lock before expiring its links.
    // Reload the comparison after waiting so erased frozen pointers cannot win.
    const [source] = await tx
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.id, candidate.sourceJobId))
      .for('update');
    const [row] = await tx
      .select()
      .from(schema.workflowComparisons)
      .where(eq(schema.workflowComparisons.id, candidate.id))
      .for('update');
    if (row?.status !== 'COLLECTED') return { dispatched: false, skipped: 'empty' } as const;
    const [input] = await tx
      .select()
      .from(schema.jobInputs)
      .where(eq(schema.jobInputs.jobId, row.sourceJobId));
    const [output] = await tx
      .select()
      .from(schema.jobOutputs)
      .where(eq(schema.jobOutputs.jobId, row.sourceJobId));
    const { personKey, garmentKey } = row;
    const resultKey = output?.resultKey;
    let expired =
      source?.status !== 'COMPLETED' ||
      !input ||
      paramsObject(input.params).comparisonErased === true ||
      !personKey ||
      !garmentKey ||
      !resultKey;
    if (!expired && personKey && garmentKey && resultKey) {
      for (const key of [personKey, garmentKey, resultKey]) {
        try {
          await app.storage.headObject(key);
        } catch (err) {
          if (!missingObject(err)) throw err;
          expired = true;
          break;
        }
      }
    }
    if (expired || !personKey || !garmentKey) {
      await tx
        .update(schema.workflowComparisons)
        .set({
          status: 'EXPIRED',
          personKey: null,
          garmentKey: null,
          unsupportedReason: 'SOURCE_EXPIRED',
          updatedAt: new Date(),
        })
        .where(eq(schema.workflowComparisons.id, row.id));
      return { dispatched: false, skipped: 'empty' } as const;
    }
    const systemUserId = await ensureComparisonSystemUser(tx);
    const replay = await insertReplayJob(tx, {
      systemUserId,
      personKey,
      garmentKey,
      templateId: row.templateId,
      templateVersion: row.templateVersion,
    });
    await tx
      .update(schema.workflowComparisons)
      .set({ status: 'QUEUED', generalJobId: replay.jobId, updatedAt: new Date() })
      .where(eq(schema.workflowComparisons.id, row.id));
    return { dispatched: true, skipped: null, jobId: replay.jobId, systemUserId } as const;
  });
  if (decision.dispatched) await enqueueReplayJob(app, decision.jobId, decision.systemUserId);
  return { dispatched: decision.dispatched, skipped: decision.skipped };
}

export function startComparisonDispatcher(app: FastifyInstance, intervalMs = 30_000): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void runDispatchTick(app)
      .catch((err) => app.log.error({ err }, 'comparison dispatcher tick failed'))
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  return () => clearInterval(timer);
}
