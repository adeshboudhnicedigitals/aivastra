import { schema } from '@aivastra/db';
import { jobsCreatedTotal } from '@aivastra/observability';
import type { CreateSareeMannequinJobRequest } from '@aivastra/types';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { assertOwnsUploadKey } from './create.js';

export async function createSareeMannequinJob(
  app: FastifyInstance,
  userId: string,
  body: z.infer<typeof CreateSareeMannequinJobRequest>,
) {
  const { garmentTypeId, garmentKey, faceId } = body;

  await assertOwnsUploadKey(app, userId, garmentKey);

  const [garmentType] = await app.db
    .select({
      isActive: schema.garmentSubcategories.isActive,
      requiresMannequinStep: schema.garmentSubcategories.requiresMannequinStep,
      mannequinWorkflowTemplateId: schema.garmentSubcategories.mannequinWorkflowTemplateId,
    })
    .from(schema.garmentSubcategories)
    .where(eq(schema.garmentSubcategories.id, garmentTypeId));
  if (!garmentType?.isActive || !garmentType.requiresMannequinStep) {
    throw new AppError('BAD_CATALOG', 400, 'garment type does not use a mannequin step');
  }
  if (!garmentType.mannequinWorkflowTemplateId) {
    throw new AppError('CONFIG', 400, 'garment type missing step-1 workflow configuration');
  }

  const [face] = await app.db
    .select({ id: schema.modelFaces.id })
    .from(schema.modelFaces)
    .where(and(eq(schema.modelFaces.id, faceId), eq(schema.modelFaces.isActive, true)));
  if (!face) throw new AppError('BAD_CATALOG', 400, 'face not found or inactive');

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

  const job = await app.db.transaction(async (tx) => {
    const [newJob] = await tx
      .insert(schema.jobs)
      .values({
        userId,
        status: 'QUEUED',
        priority,
        queueStream,
        watermark,
        creditsCharged: 0,
        source: 'saree_mannequin',
      })
      .returning();
    await tx.insert(schema.jobInputs).values({
      jobId: newJob.id,
      upperGarmentKey: garmentKey,
      faceId,
      garmentTypeId,
      params: { kind: 'saree_mannequin' },
    });
    return newJob;
  });

  const stream = `jobs:${queueStream}`;
  try {
    await app.redis.xadd(stream, 'MAXLEN', '~', 10000, '*', 'jobId', job.id, 'userId', userId);
    jobsCreatedTotal.inc({ priority: queueStream, kind: 'saree_mannequin' });
  } catch (err) {
    app.log.error({ err, jobId: job.id }, 'redis xadd failed — mannequin job marked failed');
    await app.db
      .update(schema.jobs)
      .set({ status: 'FAILED', errorCode: 'ENQUEUE_FAIL' })
      .where(eq(schema.jobs.id, job.id));
    throw new AppError('ENQUEUE_FAIL', 503, 'queue unavailable');
  }

  return { jobId: job.id };
}
