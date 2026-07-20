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
 * Shared insert/deduct/enqueue/refund-on-fail core for every dev-API job kind.
 * Deliberately NOT part of jobs/create.ts — see createDevTryonJob's original
 * comment for why the dev API needs its own creation path.
 */
export async function createDevJobCore(
  app: FastifyInstance,
  params: {
    merchantUserId: string;
    apiKeyId: string;
    cost: number;
    watermark: boolean;
    metricKind: string;
    buildJobInputs: () => Omit<typeof schema.jobInputs.$inferInsert, 'jobId'>;
  },
): Promise<{ jobId: string }> {
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
        watermark: params.watermark,
        creditsCharged: params.cost,
        source: 'api',
      })
      .returning();
    if (!newJob) throw new AppError('INTERNAL', 500, 'failed to create job');

    await atomicDeduct(tx as unknown as DB, params.merchantUserId, params.cost, newJob.id);

    await tx.insert(schema.jobInputs).values({
      jobId: newJob.id,
      ...params.buildJobInputs(),
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
    jobsCreatedTotal.inc({ priority: 'normal', kind: params.metricKind });
  } catch (err) {
    app.log.error(
      { err, jobId: job.id },
      `redis xadd failed — dev ${params.metricKind} job will be refunded`,
    );
    await refund(app.db, params.merchantUserId, params.cost, job.id, 'REFUND_ENQUEUE_FAIL');
    await app.db
      .update(schema.jobs)
      .set({ status: 'FAILED', errorCode: 'ENQUEUE_FAIL' })
      .where(eq(schema.jobs.id, job.id));
    throw new AppError('ENQUEUE_FAIL', 503, 'queue unavailable');
  }

  return { jobId: job.id };
}

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

  // Kill-switch parity: a category an admin deactivated, or one whose workflow
  // template is inactive, must not resolve. This runs before any credit
  // movement, so a rejected request is always free.
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
    .where(eq(schema.users.id, params.merchantUserId));
  if (!user || user.isBanned) throw new AppError('FORBIDDEN', 403, 'account suspended');

  return createDevJobCore(app, {
    merchantUserId: params.merchantUserId,
    apiKeyId: params.apiKeyId,
    cost,
    watermark: false,
    metricKind: 'tryon',
    buildJobInputs: () => ({
      upperGarmentKey: params.garmentKey,
      params: { personKey: params.personKey, workflowTemplateId: category.workflowTemplateId },
    }),
  });
}
