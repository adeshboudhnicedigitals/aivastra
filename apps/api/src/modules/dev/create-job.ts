import { randomUUID } from 'node:crypto';
import type { DB } from '@aivastra/db';
import { schema } from '@aivastra/db';
import { jobsCreatedTotal } from '@aivastra/observability';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../../lib/errors.js';
import { getTryonCreditCost } from '../../lib/resolution-config.js';
import { atomicDeduct, refund } from '../credits/ledger.js';

/**
 * Creates a developer-API try-on job from a raw person image + raw garment image
 * + category slug.
 *
 * Deliberately NOT part of jobs/create.ts::createSimpleTryonJob. That function
 * requires the garment to be a prior COMPLETED job of the caller (sourceJobId)
 * and resolves the workflow through a garment-type → tryon-category chain. A
 * third-party developer has neither, so this resolves the workflow straight off
 * tryon_categories.slug. Same reasoning merchant/create-job.ts documents at its top.
 *
 * The job row is userId-owned (the merchant's user) so the dispatcher's existing
 * transactional refund-on-terminal-failure path applies with no changes.
 */
export async function createDevTryonJob(
  app: FastifyInstance,
  params: {
    merchantId: string;
    merchantUserId: string;
    apiKeyId: string;
    categorySlug: string;
    personKey: string;
    garmentKey: string;
  },
): Promise<{ jobId: string }> {
  const cost = await getTryonCreditCost(app);

  // Kill-switch parity with createSimpleTryonJob: a category an admin deactivated,
  // or one whose workflow template is inactive, must not resolve. This runs before
  // any credit movement, so a rejected request is always free.
  const [category] = await app.db
    .select({
      workflowTemplateId: schema.tryonCategories.workflowTemplateId,
      templateIsActive: schema.workflowTemplates.isActive,
    })
    .from(schema.tryonCategories)
    .leftJoin(
      schema.workflowTemplates,
      eq(schema.workflowTemplates.id, schema.tryonCategories.workflowTemplateId),
    )
    .where(
      and(
        eq(schema.tryonCategories.slug, params.categorySlug),
        eq(schema.tryonCategories.isActive, true),
      ),
    )
    .limit(1);

  if (!category) throw new AppError('BAD_CATEGORY', 400, 'unknown or inactive category');
  if (!category.workflowTemplateId || !category.templateIsActive) {
    throw new AppError('BAD_CATEGORY', 400, 'category has no active workflow configured');
  }

  const [user] = await app.db
    .select({ isBanned: schema.users.isBanned })
    .from(schema.users)
    .where(eq(schema.users.id, params.merchantUserId))
    .limit(1);
  if (!user || user.isBanned) throw new AppError('FORBIDDEN', 403, 'account suspended');

  const catalogueId = randomUUID();
  const [job] = await app.db.transaction(async (tx) => {
    const [newJob] = await tx
      .insert(schema.jobs)
      .values({
        userId: params.merchantUserId,
        apiKeyId: params.apiKeyId,
        catalogueId,
        status: 'QUEUED',
        priority: false,
        queueStream: 'normal',
        watermark: false,
        creditsCharged: cost,
        source: 'api',
      })
      .returning();
    if (!newJob) throw new AppError('INTERNAL', 500, 'failed to create job');

    await atomicDeduct(tx as unknown as DB, params.merchantUserId, cost, newJob.id);

    // No faceId/backgroundId/poseId: that absence, plus params.personKey, is
    // exactly what routes this job to the tryon path in the dispatcher
    // (apps/dispatcher/src/job/processor.ts:134). Do not add those fields here.
    await tx.insert(schema.jobInputs).values({
      jobId: newJob.id,
      upperGarmentKey: params.garmentKey,
      params: { personKey: params.personKey, workflowTemplateId: category.workflowTemplateId },
    });
    return [newJob];
  });
  if (!job) throw new AppError('INTERNAL', 500, 'failed to create job');

  try {
    await app.redis.xadd(
      'jobs:normal',
      'MAXLEN',
      '~',
      10000,
      '*',
      'jobId',
      job.id,
      'userId',
      params.merchantUserId,
    );
    jobsCreatedTotal.inc({ priority: 'normal', kind: 'tryon' });
  } catch (err) {
    app.log.error({ err, jobId: job.id }, 'redis xadd failed — dev tryon job will be refunded');
    await refund(app.db, params.merchantUserId, cost, job.id, 'REFUND_ENQUEUE_FAIL');
    await app.db
      .update(schema.jobs)
      .set({ status: 'FAILED', errorCode: 'ENQUEUE_FAIL' })
      .where(eq(schema.jobs.id, job.id));
    throw new AppError('ENQUEUE_FAIL', 503, 'queue unavailable');
  }

  return { jobId: job.id };
}
