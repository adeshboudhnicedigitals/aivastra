import { schema } from '@aivastra/db';
import { keys } from '@aivastra/storage';
import { eq, inArray, sql } from 'drizzle-orm';
import type { ProcessorConfig } from './processor.js';
import { transitionJob } from './state.js';

const TERMINAL_FAILURE_STATUSES = new Set(['FAILED', 'CANCELLED']);

/**
 * Periodic sweep — promotes step-2 catalog jobs stuck in PENDING_MANNEQUIN once
 * their linked mannequin job (job_inputs.params->>'mannequinJobId') reaches a
 * terminal state. This is the ONLY thing that turns a mannequin job's success
 * into an actual queued tryon job — deliberately server-side and connection-
 * independent (no browser/SSE dependency), unlike the client-driven flow this
 * replaces. Idempotent: safe to run concurrently with itself on an interval,
 * safe to re-run after a crash (it only ever acts on rows still in
 * PENDING_MANNEQUIN, and the status flip is the first thing each branch does
 * — a re-run after promotion/refund finds the row no longer PENDING_MANNEQUIN
 * and skips it).
 */
export async function promoteSareeStep2Jobs(cfg: ProcessorConfig): Promise<void> {
  const { db, redis, pub, log } = cfg;

  const pending = await db
    .select({
      jobId: schema.jobs.id,
      userId: schema.jobs.userId,
      queueStream: schema.jobs.queueStream,
      creditsCharged: schema.jobs.creditsCharged,
      mannequinJobId: sql<string | null>`${schema.jobInputs.params}->>'mannequinJobId'`.as(
        'mannequin_job_id',
      ),
    })
    .from(schema.jobs)
    .innerJoin(schema.jobInputs, eq(schema.jobInputs.jobId, schema.jobs.id))
    .where(eq(schema.jobs.status, 'PENDING_MANNEQUIN'));

  if (pending.length === 0) return;

  const mannequinIds = Array.from(
    new Set(pending.map((p) => p.mannequinJobId).filter((id): id is string => !!id)),
  );
  if (mannequinIds.length === 0) return;

  const mannequinJobs = await db
    .select({ id: schema.jobs.id, status: schema.jobs.status })
    .from(schema.jobs)
    .where(inArray(schema.jobs.id, mannequinIds));
  const mannequinStatusById = new Map(mannequinJobs.map((m) => [m.id, m.status]));

  for (const row of pending) {
    if (!row.userId) {
      log.error(
        { jobId: row.jobId },
        'PENDING_MANNEQUIN job has no userId — cannot promote or refund, skipping',
      );
      continue;
    }
    const userId = row.userId;

    if (!row.mannequinJobId) {
      log.error(
        { jobId: row.jobId },
        'PENDING_MANNEQUIN job has no mannequinJobId in params — orphaned, skipping',
      );
      continue;
    }

    const mannequinStatus = mannequinStatusById.get(row.mannequinJobId);
    if (!mannequinStatus) {
      log.error(
        { jobId: row.jobId, mannequinJobId: row.mannequinJobId },
        'PENDING_MANNEQUIN job references a mannequin job that no longer exists — skipping',
      );
      continue;
    }

    if (mannequinStatus === 'COMPLETED') {
      const outputKey = keys.output(row.mannequinJobId);
      // Update the parent's status is not needed here — only the child row.
      // Re-running this sweep after a crash mid-promotion is safe: the update
      // is idempotent (same key written again), and transitionJob only flips
      // status away from PENDING_MANNEQUIN once, after which this row is no
      // longer selected by the query above.
      await db
        .update(schema.jobInputs)
        .set({ upperGarmentKey: outputKey })
        .where(eq(schema.jobInputs.jobId, row.jobId));
      await transitionJob(db, pub, row.jobId, userId, 'QUEUED', {}, log);
      await redis.xadd(
        `jobs:${row.queueStream}`,
        'MAXLEN',
        '~',
        10000,
        '*',
        'jobId',
        row.jobId,
        'userId',
        userId,
      );
      log.info(
        { jobId: row.jobId, mannequinJobId: row.mannequinJobId },
        'saree step-2 job promoted to QUEUED',
      );
      continue;
    }

    if (TERMINAL_FAILURE_STATUSES.has(mannequinStatus)) {
      await db.transaction(async (tx) => {
        // Insert ledger row first — unique index on (job_id, reason) prevents
        // double-refund if this sweep somehow races itself for the same row.
        if (row.creditsCharged > 0) {
          const inserted = await tx
            .insert(schema.creditLedger)
            .values({
              userId,
              delta: row.creditsCharged,
              reason: 'JOB_FAIL_REFUND',
              jobId: row.jobId,
            })
            .onConflictDoNothing()
            .returning({ id: schema.creditLedger.id });
          if (inserted.length) {
            await tx
              .update(schema.userCredits)
              .set({ balance: sql`${schema.userCredits.balance} + ${row.creditsCharged}` })
              .where(eq(schema.userCredits.userId, userId));
          }
        }
        await tx
          .update(schema.jobs)
          .set({
            status: 'FAILED',
            errorCode: 'MANNEQUIN_STEP_FAILED',
            completedAt: new Date(),
          } as Parameters<ReturnType<typeof tx.update>['set']>[0])
          .where(eq(schema.jobs.id, row.jobId));
        await tx.insert(schema.jobEvents).values({
          jobId: row.jobId,
          eventType: 'FAILED',
          payload: { errorCode: 'MANNEQUIN_STEP_FAILED' } as Record<string, unknown>,
        });
      });

      const ssePayload = JSON.stringify({
        jobId: row.jobId,
        userId,
        type: 'STATUS',
        status: 'FAILED',
        errorCode: 'MANNEQUIN_STEP_FAILED',
      });
      await Promise.all([
        pub.publish(`sse:events:${userId}`, ssePayload),
        pub.publish('sse:events:admin', ssePayload),
      ]);
      log.warn(
        { jobId: row.jobId, mannequinJobId: row.mannequinJobId, mannequinStatus },
        'saree step-2 job failed — mannequin step did not complete, refunded',
      );
    }

    // Any other mannequin status (QUEUED/PREPROCESSING/GENERATING/UPLOADING) —
    // leave as-is, checked again next sweep.
  }
}
