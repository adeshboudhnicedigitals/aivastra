import { randomUUID } from 'node:crypto';
import type { DB } from '@aivastra/db';
import { schema } from '@aivastra/db';
import { jobsCreatedTotal } from '@aivastra/observability';
import { type CreateFabricToGarmentJobRequest, JOB_SOURCE } from '@aivastra/types';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { getFabricToGarmentCreditCost } from '../../lib/resolution-config.js';
import { atomicDeduct, refundAndMarkFailed } from '../credits/ledger.js';
import { resolveQueueRouting, verifyGarmentKey } from './create.js';

export async function createFabricToGarmentJob(
  app: FastifyInstance,
  userId: string,
  body: z.infer<typeof CreateFabricToGarmentJobRequest>,
) {
  const { productImageKey, fabricGarmentTypeId } = body;
  const COST = await getFabricToGarmentCreditCost(app);

  await verifyGarmentKey(app, userId, productImageKey);

  const [wf] = await app.db
    .select({ id: schema.workflowTemplates.id, version: schema.workflowTemplates.version })
    .from(schema.workflowTemplates)
    .where(
      and(
        eq(schema.workflowTemplates.workflowType, 'fabric_to_garment'),
        eq(schema.workflowTemplates.isActive, true),
      ),
    )
    .limit(1);
  if (!wf) {
    throw new AppError('CONFIG', 400, 'no active fabric-to-garment workflow template configured');
  }

  const [preset] = await app.db
    .select()
    .from(schema.fabricGarmentTypes)
    .where(
      and(
        eq(schema.fabricGarmentTypes.id, fabricGarmentTypeId),
        eq(schema.fabricGarmentTypes.isActive, true),
      ),
    )
    .limit(1);
  if (!preset) {
    throw new AppError('VALIDATION', 400, 'garment type not found or inactive');
  }

  const { queueStream, priority, watermark } = await resolveQueueRouting(app, userId);

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
        source: JOB_SOURCE.FABRIC_TO_GARMENT,
      })
      .returning();
    await atomicDeduct(tx as unknown as DB, userId, COST, newJob.id);
    await tx.insert(schema.jobInputs).values({
      jobId: newJob.id,
      upperGarmentKey: productImageKey,
      params: {
        kind: 'fabric_to_garment',
        workflowTemplateId: wf.id,
        dispatchTemplateVersion: wf.version,
        fabricGarmentTypeId: preset.id,
        prompt: preset.prompt,
        negativePrompt: preset.negativePrompt,
      },
    });
    return newJob;
  });

  const stream = `jobs:${queueStream}`;
  try {
    await app.redis.xadd(stream, 'MAXLEN', '~', 10000, '*', 'jobId', job.id, 'userId', userId);
    jobsCreatedTotal.inc({ priority: queueStream, kind: JOB_SOURCE.FABRIC_TO_GARMENT });
  } catch (err) {
    app.log.error(
      { err, jobId: job.id },
      'redis xadd failed — fabric-to-garment job will be refunded',
    );
    await refundAndMarkFailed(app.db, userId, COST, job.id, 'REFUND_ENQUEUE_FAIL', 'ENQUEUE_FAIL');
    throw new AppError('ENQUEUE_FAIL', 503, 'queue unavailable');
  }

  return { jobId: job.id, catalogueId };
}
