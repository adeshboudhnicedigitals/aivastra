import { randomUUID } from 'node:crypto';
import type { DB } from '@aivastra/db';
import { schema } from '@aivastra/db';
import { jobsCreatedTotal } from '@aivastra/observability';
import { JOB_SOURCE, type JobSource, WORKER_POOL } from '@aivastra/types';
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../../lib/errors.js';
import { assertMerchantJobRateLimit } from '../../lib/job-rate-limit.js';
import { getTryonCreditCost } from '../../lib/resolution-config.js';
import { atomicDeduct, refundAndMarkFailed } from '../credits/ledger.js';
import { lockAndAssertUserCanCreateJobs } from '../jobs/creation-guard.js';

/**
 * Shared insert/deduct/enqueue/refund-on-fail core for every dev-API job kind.
 * Deliberately NOT part of jobs/create.ts — see createDevTryonJob's original
 * comment for why the dev API needs its own creation path.
 */
export async function createDevJobCore(
  app: FastifyInstance,
  params: {
    merchantUserId: string;
    // null for callers with no API key — e.g. the Chrome extension, where the
    // caller authenticates as a platform user (JWT) on their own account, not
    // a merchant's API key. jobs.api_key_id is nullable for exactly this case.
    apiKeyId: string | null;
    cost: number;
    watermark: boolean;
    source: JobSource;
    // 'inhouse' = the dedicated lane (jobs:inhouse) consumed only by workers tagged
    // 'inhouse'; everything else rides the shared jobs:normal.
    lane?: 'normal' | 'inhouse';
    // One id shared by every job of a run (the WhatsApp try-on run id). Absent: a fresh
    // id per job, as before.
    catalogueId?: string;
    buildJobInputs: () => Omit<typeof schema.jobInputs.$inferInsert, 'jobId'>;
  },
): Promise<{ jobId: string }> {
  await assertMerchantJobRateLimit(app, params.merchantUserId);

  const lane = params.lane ?? 'normal';
  const catalogueId = params.catalogueId ?? randomUUID();
  const [job] = await app.db.transaction(async (tx) => {
    await lockAndAssertUserCanCreateJobs(tx, params.merchantUserId);
    const [newJob] = await tx
      .insert(schema.jobs)
      .values({
        userId: params.merchantUserId,
        apiKeyId: params.apiKeyId,
        catalogueId,
        status: 'QUEUED',
        priority: false,
        queueStream: lane,
        watermark: params.watermark,
        creditsCharged: params.cost,
        source: params.source,
      })
      .returning();
    if (!newJob) throw new AppError('INTERNAL', 500, 'failed to create job');

    await atomicDeduct(tx as unknown as DB, params.merchantUserId, params.cost, newJob.id);

    // buildJobInputs()'s return shape is routing-significant: the dispatcher
    // (apps/dispatcher/src/job/processor.ts) decides which processing path a
    // job takes based on which of faceId/backgroundId/poseId/params.kind are
    // present. Callers must get this shape right for their job kind.
    await tx.insert(schema.jobInputs).values({
      jobId: newJob.id,
      ...params.buildJobInputs(),
    });
    return [newJob];
  });
  if (!job) throw new AppError('INTERNAL', 500, 'failed to create job');

  try {
    await app.redis.xadd(
      `jobs:${lane}`,
      'MAXLEN',
      '~',
      10000,
      '*',
      'jobId',
      job.id,
      'userId',
      params.merchantUserId,
    );
    jobsCreatedTotal.inc({ priority: 'normal', kind: params.source });
  } catch (err) {
    app.log.error(
      { err, jobId: job.id },
      `redis xadd failed — dev ${params.source} job will be refunded`,
    );
    // refundAndMarkFailed does the refund + FAILED transition as one atomic,
    // idempotent operation (guarded on status='QUEUED') — closes the crash-
    // between-two-calls gap a separate refund() + UPDATE would leave open.
    await refundAndMarkFailed(
      app.db,
      params.merchantUserId,
      params.cost,
      job.id,
      'REFUND_ENQUEUE_FAIL',
      'ENQUEUE_FAIL',
    );
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
 * dev_tryon_categories.slug — a dedicated table decoupled from the internal
 * tryon_categories table used by Studio/kiosk/merchant flows. Same reasoning
 * merchant/create-job.ts documents at its top.
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
    integration: 'generic' | 'wordpress';
    categorySlug: string;
    personKey: string;
    garmentKey: string;
    // Pins dispatch to specific GPU workers instead of the normal round-robin
    // pool — see apps/dispatcher/src/worker/selector.ts's selectPreferredWorker.
    // Validated here (exists, active, tryon-eligible) so a typo'd worker id
    // fails fast with a clear error instead of silently failing the job at
    // dispatch time after credits are already charged.
    primaryWorkerIds?: string[];
    fallbackWorkerIds?: string[];
    // Sends the job to the dedicated 'inhouse' workers instead of the shared tryon
    // pool. The caller must already have checked the account is allowed to.
    inhouse?: boolean;
  },
): Promise<{ jobId: string }> {
  const cost = await getTryonCreditCost(app);

  const pool = params.inhouse ? WORKER_POOL.INHOUSE : WORKER_POOL.TRYON;
  const pinnedWorkerIds = [...(params.primaryWorkerIds ?? []), ...(params.fallbackWorkerIds ?? [])];
  if (pinnedWorkerIds.length > 0) {
    const rows = await app.db
      .select({ id: schema.workers.id, allowedJobTypes: schema.workers.allowedJobTypes })
      .from(schema.workers)
      .where(and(inArray(schema.workers.id, pinnedWorkerIds), eq(schema.workers.isActive, true)));
    // An empty allowedJobTypes means "accepts anything" for the shared pools, but never
    // for inhouse: that lane is opt-in per worker, and a pinned production job must not
    // land on a dedicated inhouse worker (the dispatcher's claim enforces the same).
    const eligible = new Set(
      rows
        .filter((w) =>
          params.inhouse
            ? w.allowedJobTypes.includes(pool)
            : w.allowedJobTypes.length === 0 || w.allowedJobTypes.includes(pool),
        )
        .map((w) => w.id),
    );
    const badId = pinnedWorkerIds.find((id) => !eligible.has(id));
    if (badId) {
      throw new AppError(
        'BAD_WORKER_ID',
        400,
        `worker "${badId}" is not an active ${params.inhouse ? 'inhouse' : 'try-on'} worker`,
      );
    }
  }

  // Without a dedicated worker the job would requeue until the sweeper refunds it —
  // fail fast, before any credit moves.
  if (params.inhouse) {
    const rows = await app.db
      .select({ allowedJobTypes: schema.workers.allowedJobTypes })
      .from(schema.workers)
      .where(eq(schema.workers.isActive, true));
    if (!rows.some((w) => w.allowedJobTypes.includes(pool))) {
      throw new AppError('NO_INHOUSE_WORKER', 503, 'no active inhouse worker is configured');
    }
  }

  // Resolve off the DEDICATED dev table, not tryon_categories — the public API
  // surface is controlled independent of the internal Studio catalog. Kill-switch
  // parity: an inactive dev category, or one whose workflow template is inactive,
  // must not resolve. Runs before any credit movement, so a rejected request is free.
  const [category] = await app.db
    .select({
      workflowTemplateId: schema.devTryonCategories.workflowTemplateId,
      templateVersion: schema.workflowTemplates.version,
      templateIsActive: schema.workflowTemplates.isActive,
    })
    .from(schema.devTryonCategories)
    .leftJoin(
      schema.workflowTemplates,
      eq(schema.workflowTemplates.id, schema.devTryonCategories.workflowTemplateId),
    )
    .where(
      and(
        eq(schema.devTryonCategories.slug, params.categorySlug),
        eq(schema.devTryonCategories.isActive, true),
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
    // Never trust a client-supplied field for this — integration is resolved
    // server-side by dev-api-auth.ts from the authenticated key row, the same
    // place merchantId/merchantUserId are already resolved.
    source: params.integration === 'wordpress' ? JOB_SOURCE.WORDPRESS_TRYON : JOB_SOURCE.API_TRYON,
    lane: params.inhouse ? 'inhouse' : 'normal',
    buildJobInputs: () => ({
      upperGarmentKey: params.garmentKey,
      params: {
        personKey: params.personKey,
        workflowTemplateId: category.workflowTemplateId,
        dispatchTemplateVersion: category.templateVersion ?? null,
        // The dispatcher picks the worker pool off this flag (processTryonDirectJob).
        ...(params.inhouse ? { inhouse: true } : {}),
        ...(params.primaryWorkerIds?.length ? { primaryWorkerIds: params.primaryWorkerIds } : {}),
        ...(params.fallbackWorkerIds?.length
          ? { fallbackWorkerIds: params.fallbackWorkerIds }
          : {}),
      },
    }),
  });
}
