import { randomUUID } from 'node:crypto';
import type { DB } from '@aivastra/db';
import { schema } from '@aivastra/db';
import { jobsCreatedTotal } from '@aivastra/observability';
import { type CreateSareeJobRequest, JOB_SOURCE } from '@aivastra/types';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { getTryonCreditCost } from '../../lib/resolution-config.js';
import { atomicDeduct, refundAndMarkFailed } from '../credits/ledger.js';
import { getSareeSettings } from '../saree/settings.js';
import { assertOwnsUploadKey } from './create.js';

export async function createSareeJob(
  app: FastifyInstance,
  userId: string,
  body: z.infer<typeof CreateSareeJobRequest>,
) {
  const { garmentKey } = body;
  const COST = await getTryonCreditCost(app);

  // 1. Ownership + existence + size check on the user-uploaded saree.
  await assertOwnsUploadKey(app, userId, garmentKey);

  // 2. Saree must be configured (admin uploaded a model image).
  const settings = await getSareeSettings(app.db);
  if (!settings?.modelImageKey) {
    throw new AppError('NOT_CONFIGURED', 400, 'saree try-on is not configured by admin');
  }

  // 3. Must be an active saree workflow.
  const [wf] = await app.db
    .select({ id: schema.workflowTemplates.id })
    .from(schema.workflowTemplates)
    .where(
      and(
        eq(schema.workflowTemplates.workflowType, 'saree'),
        eq(schema.workflowTemplates.isActive, true),
      ),
    )
    .limit(1);
  if (!wf) {
    throw new AppError('CONFIG', 400, 'no active saree workflow template configured');
  }

  // 4. User must exist and not be banned.
  const [[user], [planRow]] = await Promise.all([
    app.db.select().from(schema.users).where(eq(schema.users.id, userId)),
    app.db
      .select({
        queueStream: schema.creditPlans.queueStream,
        watermark: schema.creditPlans.watermark,
      })
      .from(schema.users)
      .innerJoin(schema.creditPlans, eq(schema.users.tier, schema.creditPlans.slug))
      .where(eq(schema.users.id, userId)),
  ]);
  if (!user || user.isBanned) throw new AppError('FORBIDDEN', 403, 'banned');

  const queueStream: string = planRow?.queueStream ?? 'normal';
  const priority = queueStream === 'priority';
  const watermark: boolean = planRow?.watermark ?? false;

  // 5. Deduct + insert in a single txn (mirrors createSimpleTryonJob).
  const catalogueId = randomUUID();
  const job = await app.db.transaction(async (tx) => {
    const [newJob] = await tx
      .insert(schema.jobs)
      .values({
        userId,
        catalogueId,
        status: 'QUEUED',
        priority,
        queueStream,
        watermark,
        creditsCharged: COST,
        source: JOB_SOURCE.SAREE,
      })
      .returning();
    await atomicDeduct(tx as unknown as DB, userId, COST, newJob.id);
    await tx.insert(schema.jobInputs).values({
      jobId: newJob.id,
      upperGarmentKey: garmentKey,
      params: {
        modelKey: settings.modelImageKey,
        workflowTemplateId: wf.id,
        kind: 'saree',
      },
    });
    return newJob;
  });

  // 6. XADD to the right stream. Refund on failure.
  const stream = `jobs:${queueStream}`;
  try {
    await app.redis.xadd(stream, 'MAXLEN', '~', 10000, '*', 'jobId', job.id, 'userId', userId);
    jobsCreatedTotal.inc({ priority: queueStream, kind: JOB_SOURCE.SAREE });
  } catch (err) {
    app.log.error({ err, jobId: job.id }, 'redis xadd failed — saree job will be refunded');
    // refundAndMarkFailed does the refund + FAILED transition as one atomic,
    // idempotent operation (guarded on status='QUEUED') — closes the crash-
    // between-two-calls gap a separate refund() + UPDATE would leave open.
    await refundAndMarkFailed(app.db, userId, COST, job.id, 'REFUND_ENQUEUE_FAIL', 'ENQUEUE_FAIL');
    throw new AppError('ENQUEUE_FAIL', 503, 'queue unavailable');
  }

  return { jobId: job.id, catalogueId };
}
