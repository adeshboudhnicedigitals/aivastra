import { type DB, schema } from '@aivastra/db';
import type { Logger } from '@aivastra/logger';
import { eq } from 'drizzle-orm';
import type { Redis } from 'ioredis';

export type JobStatus =
  | 'PENDING_MANNEQUIN'
  | 'QUEUED'
  | 'PREPROCESSING'
  | 'GENERATING'
  | 'UPLOADING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export interface TransitionOptions {
  workerId?: string;
  errorCode?: string;
  resultKey?: string;
  thumbnailKey?: string;
  /**
   * When true, skip the job_outputs insert/upsert — the caller has already
   * written that row (e.g. finalizeOutput() writes it with assetKind/watermarkVersion).
   * The resultKey/thumbnailKey are still included in the SSE payload.
   */
  skipOutputInsert?: boolean;
}

export async function transitionJob(
  db: DB,
  pub: Redis,
  jobId: string,
  userId: string,
  status: JobStatus,
  opts: TransitionOptions = {},
  log: Logger,
): Promise<void> {
  const now = new Date();
  const patch: Record<string, unknown> = { status };
  if (opts.workerId !== undefined) patch.workerId = opts.workerId;
  if (opts.errorCode !== undefined) patch.errorCode = opts.errorCode;
  if (status === 'GENERATING') patch.startedAt = now;
  if (status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED')
    patch.completedAt = now;

  await db
    .update(schema.jobs)
    .set(patch as Parameters<ReturnType<typeof db.update>['set']>[0])
    .where(eq(schema.jobs.id, jobId));

  if (opts.resultKey && status === 'COMPLETED' && !opts.skipOutputInsert) {
    await db
      .insert(schema.jobOutputs)
      .values({ jobId, resultKey: opts.resultKey, thumbnailKey: opts.thumbnailKey ?? null })
      .onConflictDoUpdate({
        target: schema.jobOutputs.jobId,
        set: { resultKey: opts.resultKey, thumbnailKey: opts.thumbnailKey ?? null },
      });
  }

  await db.insert(schema.jobEvents).values({
    jobId,
    eventType: status,
    payload: opts as Record<string, unknown>,
  });

  const ssePayload = JSON.stringify({ jobId, userId, type: 'STATUS', status, ...opts });
  await Promise.all([
    pub.publish(`sse:events:${userId}`, ssePayload),
    pub.publish('sse:events:admin', ssePayload),
  ]);
  log.info({ jobId, userId, status }, 'job state transition');
}
