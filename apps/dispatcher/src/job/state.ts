import { type DB, schema } from '@aivastra/db';
import type { Logger } from '@aivastra/logger';
import { jobE2eDuration } from '@aivastra/observability';
import { and, eq, ne } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { checkAndCleanupArchiveForJob } from '../workflow/drain-cleanup.js';

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
   * written that row. finalizeOutput delegates its metadata insert to this transaction.
   * The resultKey/thumbnailKey are still included in the SSE payload.
   */
  skipOutputInsert?: boolean;
  assetKind?: 'ORIGINAL' | 'WATERMARKED';
  watermarkVersion?: number | null;
  /**
   * Store-billed Shopify jobs only: SSE publishes to `sse:events:store:${shopifyStoreId}`
   * instead of `sse:events:${userId}`. Callers on this path pass userId as '' (mirrors
   * the existing kiosk-job convention of an empty userId for jobs with no real user).
   */
  shopifyStoreId?: string;
}

export async function transitionJob(
  db: DB,
  pub: Redis,
  jobId: string,
  userId: string,
  status: JobStatus,
  opts: TransitionOptions = {},
  log: Logger,
): Promise<boolean> {
  const now = new Date();
  const patch: Record<string, unknown> = { status };
  if (opts.workerId !== undefined) patch.workerId = opts.workerId;
  if (opts.errorCode !== undefined) patch.errorCode = opts.errorCode;
  if (status === 'GENERATING') patch.startedAt = now;
  if (status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED')
    patch.completedAt = now;

  const updated = await db.transaction(async (tx) => {
    const rows = await tx
      .update(schema.jobs)
      .set(patch as Parameters<ReturnType<typeof tx.update>['set']>[0])
      // Intermediate writes must not erase CANCELLED before the completion guard.
      .where(
        and(
          eq(schema.jobs.id, jobId),
          status === 'CANCELLED' ? undefined : ne(schema.jobs.status, 'CANCELLED'),
        ),
      )
      .returning({ createdAt: schema.jobs.createdAt, source: schema.jobs.source });
    if (!rows.length) return rows;
    if (opts.resultKey && status === 'COMPLETED' && !opts.skipOutputInsert) {
      await tx
        .insert(schema.jobOutputs)
        .values({
          jobId,
          resultKey: opts.resultKey,
          thumbnailKey: opts.thumbnailKey ?? null,
          assetKind: opts.assetKind ?? 'ORIGINAL',
          watermarkVersion: opts.watermarkVersion ?? null,
        })
        .onConflictDoUpdate({
          target: schema.jobOutputs.jobId,
          set: {
            resultKey: opts.resultKey,
            thumbnailKey: opts.thumbnailKey ?? null,
            assetKind: opts.assetKind ?? 'ORIGINAL',
            watermarkVersion: opts.watermarkVersion ?? null,
          },
        });
    }
    await tx
      .insert(schema.jobEvents)
      .values({ jobId, eventType: status, payload: opts as Record<string, unknown> });
    return rows;
  });
  if (!updated.length) {
    log.warn({ jobId, status }, 'job transition skipped — cancelled or missing job');
    return false;
  }

  if (status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED') {
    const createdAt = updated[0]?.createdAt;
    if (createdAt) {
      const outcome = status.toLowerCase();
      const jobType = updated[0]?.source ?? 'unknown';
      jobE2eDuration.observe(
        { outcome, job_type: jobType },
        (now.getTime() - createdAt.getTime()) / 1000,
      );
    }

    await checkAndCleanupArchiveForJob(db, jobId, log);
  }

  const channelId = opts.shopifyStoreId ? `store:${opts.shopifyStoreId}` : userId;
  const ssePayload = JSON.stringify({ jobId, userId, type: 'STATUS', status, ...opts });
  const publishes = [pub.publish('sse:events:admin', ssePayload)];
  if (channelId) publishes.push(pub.publish(`sse:events:${channelId}`, ssePayload));
  await Promise.all(publishes);
  log.info({ jobId, userId, channelId, status }, 'job state transition');
  return true;
}
