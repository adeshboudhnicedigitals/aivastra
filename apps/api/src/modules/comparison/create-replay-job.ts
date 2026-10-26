import { randomUUID } from 'node:crypto';
import { type DB, schema } from '@aivastra/db';
import { JOB_SOURCE } from '@aivastra/types';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../../lib/errors.js';

export type ReplayJobParams = {
  systemUserId: string;
  personKey: string;
  garmentKey: string;
  templateId: string;
  templateVersion: number;
};

export const REPLAY_ENQUEUE_PENDING = 'COMPARISON_ENQUEUE_PENDING';

// Separate insertion from enqueue so the scheduler can atomically link its row
// and hold the source privacy lock in the same transaction as these inserts.
export async function insertReplayJob(
  db: Pick<DB, 'insert'>,
  p: ReplayJobParams,
): Promise<{ jobId: string }> {
  const [job] = await db
    .insert(schema.jobs)
    .values({
      userId: p.systemUserId,
      catalogueId: randomUUID(),
      status: 'QUEUED',
      priority: false,
      queueStream: 'inhouse',
      creditsCharged: 0,
      source: JOB_SOURCE.COMPARISON,
      watermark: false,
      errorCode: REPLAY_ENQUEUE_PENDING,
    })
    .returning({ id: schema.jobs.id });
  if (!job) throw new AppError('INTERNAL', 500, 'failed to create comparison job');
  await db.insert(schema.jobInputs).values({
    jobId: job.id,
    upperGarmentKey: p.garmentKey,
    params: {
      personKey: p.personKey,
      workflowTemplateId: p.templateId,
      dispatchTemplateVersion: p.templateVersion,
      inhouse: true,
    },
  });
  return { jobId: job.id };
}

export async function enqueueReplayJob(
  app: FastifyInstance,
  jobId: string,
  systemUserId: string,
): Promise<void> {
  try {
    await app.redis.xadd(
      'jobs:inhouse',
      'MAXLEN',
      '~',
      10000,
      '*',
      'jobId',
      jobId,
      'userId',
      systemUserId,
    );
  } catch (err) {
    app.log.error({ err, jobId }, 'comparison enqueue failed');
    // Redis timeouts are ambiguous: XADD may have succeeded. CANCELLED fences
    // a late consumer; FAILED alone can be advanced by transitionJob. The link
    // still reports the enqueue failure. No replay path touches the ledger.
    await app.db.transaction(async (tx) => {
      const failed = await tx
        .update(schema.jobs)
        .set({ status: 'CANCELLED', errorCode: 'ENQUEUE_FAIL', completedAt: new Date() })
        .where(and(eq(schema.jobs.id, jobId), eq(schema.jobs.status, 'QUEUED')))
        .returning({ id: schema.jobs.id });
      if (failed.length > 0)
        await tx
          .update(schema.workflowComparisons)
          .set({ status: 'FAILED', updatedAt: new Date() })
          .where(
            and(
              eq(schema.workflowComparisons.generalJobId, jobId),
              eq(schema.workflowComparisons.status, 'QUEUED'),
            ),
          );
    });
    throw new AppError('ENQUEUE_FAIL', 503, 'comparison queue unavailable');
  }
  // Keep the intent durable until Redis confirms XADD. On an ambiguous crash,
  // recovery cancels the queued job instead of risking a second GPU execution.
  await app.db
    .update(schema.jobs)
    .set({ errorCode: null })
    .where(and(eq(schema.jobs.id, jobId), eq(schema.jobs.errorCode, REPLAY_ENQUEUE_PENDING)));
}

export async function createReplayJob(
  app: FastifyInstance,
  p: ReplayJobParams,
): Promise<{ jobId: string }> {
  const replay = await app.db.transaction((tx) => insertReplayJob(tx, p));
  await enqueueReplayJob(app, replay.jobId, p.systemUserId);
  return replay;
}
