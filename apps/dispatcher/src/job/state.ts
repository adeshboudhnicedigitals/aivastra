import { type DB, schema } from '@aivastra/db';
import type { Logger } from '@aivastra/logger';
import { eq } from 'drizzle-orm';
import type { Redis } from 'ioredis';

export type JobStatus =
  | 'QUEUED'
  | 'PREPROCESSING'
  | 'GENERATING'
  | 'UPLOADING'
  | 'COMPLETED'
  | 'FAILED';

export interface TransitionOptions {
  workerId?: string;
  errorCode?: string;
  resultKey?: string;
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
  if (opts.workerId !== undefined) patch['workerId'] = opts.workerId;
  if (opts.errorCode !== undefined) patch['errorCode'] = opts.errorCode;
  if (status === 'GENERATING') patch['startedAt'] = now;
  if (status === 'COMPLETED' || status === 'FAILED') patch['completedAt'] = now;

  await db
    .update(schema.jobs)
    .set(patch as Parameters<ReturnType<typeof db.update>['set']>[0])
    .where(eq(schema.jobs.id, jobId));

  if (opts.resultKey && status === 'COMPLETED') {
    await db
      .insert(schema.jobOutputs)
      .values({ jobId, resultKey: opts.resultKey })
      .onConflictDoUpdate({ target: schema.jobOutputs.jobId, set: { resultKey: opts.resultKey } });
  }

  await db.insert(schema.jobEvents).values({
    jobId,
    eventType: status,
    payload: opts as Record<string, unknown>,
  });

  const ssePayload = JSON.stringify({ jobId, type: 'STATUS', status, ...opts });
  await pub.publish(`sse:events:${userId}`, ssePayload);
  log.info({ jobId, userId, status }, 'job state transition');
}
