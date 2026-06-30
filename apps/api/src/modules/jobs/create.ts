import { randomUUID } from 'node:crypto';
import { type DB, schema } from '@aivastra/db';
import { jobsCreatedTotal } from '@aivastra/observability';
import {
  type CreateSimpleTryonRequest,
  type CreateTryOnJobRequest,
  RESOLUTION_COSTS,
  type Resolution,
  SIMPLE_TRYON_COST,
} from '@aivastra/types';
import { aliasedTable, and, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { atomicDeduct, refund } from '../credits/ledger.js';
import { promptGuard } from './sanitize.js';

/** Max accepted garment upload size — mirrors the presign zod cap. */
const MAX_GARMENT_BYTES = 10 * 1024 * 1024;

/**
 * Reject a garment key that was not presigned for this user. The presign route
 * records `upload:owner:<key> -> userId`; a key bound to nobody (expired/never
 * issued) or to another user fails here.
 *
 * Also enforces the upload size (M2): the presigned PUT can't bind size at sign
 * time, so we verify the actually-uploaded object via HEAD before accepting the
 * job. Doubles as an existence check.
 */
async function assertOwnsUploadKey(app: FastifyInstance, userId: string, key: string) {
  const owner = await app.redis.get(`upload:owner:${key}`);
  if (owner !== userId) {
    throw new AppError('FORBIDDEN', 403, 'upload key not owned by caller');
  }
  let head: { contentLength: number };
  try {
    head = await app.storage.headObject(key);
  } catch {
    throw new AppError('BAD_UPLOAD', 400, 'uploaded garment not found');
  }
  if (head.contentLength > MAX_GARMENT_BYTES) {
    throw new AppError('BAD_UPLOAD', 413, 'uploaded garment exceeds size limit');
  }
}

export async function createJob(
  app: FastifyInstance,
  userId: string,
  body: z.infer<typeof CreateTryOnJobRequest>,
) {
  const {
    faceId,
    backgroundId,
    poseIds,
    garmentTypeId,
    upperGarmentKey,
    lowerCatalogId,
    lowerGarmentKey,
    shoeCatalogId,
  } = body.inputs;
  const aspectRatio: string | undefined = body.aspectRatio;
  const resolution: Resolution = body.resolution;
  const platform: string | undefined = body.platform;
  const COST = RESOLUTION_COSTS[resolution];

  // H2: keys are format-pinned by zod, but the format alone does not prove the
  // caller owns the object — another user's key has the same shape. Verify each
  // garment key was issued to THIS user by /v1/uploads/presign (Redis binding)
  // before any credit/DB mutation.
  await assertOwnsUploadKey(app, userId, upperGarmentKey);
  if (lowerGarmentKey) await assertOwnsUploadKey(app, userId, lowerGarmentKey);

  // Amazon platform requires a white background — override user selection with the
  // background tagged as isWhiteBg in the admin panel.
  let effectiveBackgroundId = backgroundId;
  if (platform === 'Amazon') {
    const [whiteBg] = await app.db
      .select({ id: schema.modelBackgrounds.id })
      .from(schema.modelBackgrounds)
      .where(
        and(
          eq(schema.modelBackgrounds.isActive, true),
          eq(schema.modelBackgrounds.isWhiteBg, true),
        ),
      )
      .limit(1);
    if (!whiteBg) {
      throw new AppError(
        'VALIDATION',
        400,
        'Amazon platform requires a white background to be configured',
      );
    }
    effectiveBackgroundId = whiteBg.id;
    app.log.info(
      { originalBg: backgroundId, amazonBg: effectiveBackgroundId, platform },
      'amazon bg override',
    );
  }

  const [face, background, poses] = await Promise.all([
    app.db
      .select({ id: schema.modelFaces.id })
      .from(schema.modelFaces)
      .where(and(eq(schema.modelFaces.id, faceId), eq(schema.modelFaces.isActive, true))),
    app.db
      .select({ id: schema.modelBackgrounds.id })
      .from(schema.modelBackgrounds)
      .where(
        and(
          eq(schema.modelBackgrounds.id, effectiveBackgroundId),
          eq(schema.modelBackgrounds.isActive, true),
        ),
      ),
    app.db
      .select({ id: schema.modelPoseAssets.id })
      .from(schema.modelPoseAssets)
      .where(
        and(
          inArray(schema.modelPoseAssets.id, poseIds),
          eq(schema.modelPoseAssets.isActive, true),
          isNull(schema.modelPoseAssets.deletedAt),
        ),
      ),
  ]);

  if (!face[0]) throw new AppError('BAD_CATALOG', 400, 'face not found or inactive');
  if (!background[0]) throw new AppError('BAD_CATALOG', 400, 'background not found or inactive');
  if (poses.length !== poseIds.length)
    throw new AppError('BAD_CATALOG', 400, 'one or more poses not found or inactive');

  // Validate that workflow-required inputs are present for every selected pose.
  // If a pose's workflow has a lower garment node → lowerCatalogId is mandatory.
  // Same for shoes. This mirrors what the studio UI shows based on hasLower/hasShoes.
  // A per-garment-type pose_garment_configs override (when one exists with a
  // workflowTemplateId set) takes priority over the pose's own default workflow —
  // must match the resolution used by /v1/models/poses and the dispatcher exactly,
  // otherwise the UI and the server disagree on what's required.
  const defaultWorkflow = aliasedTable(schema.workflowTemplates, 'default_workflow');
  const overrideWorkflow = aliasedTable(schema.workflowTemplates, 'override_workflow');
  const poseWorkflowRows = await app.db
    .select({
      poseId: schema.modelPoseAssets.id,
      defaultLowerNodeId: defaultWorkflow.lowerNodeId,
      defaultShoeNodeId: defaultWorkflow.shoeNodeId,
      defaultSizeNodeIds: defaultWorkflow.sizeNodeIds,
      configWorkflowTemplateId: schema.poseGarmentConfigs.workflowTemplateId,
      overrideLowerNodeId: overrideWorkflow.lowerNodeId,
      overrideShoeNodeId: overrideWorkflow.shoeNodeId,
      overrideSizeNodeIds: overrideWorkflow.sizeNodeIds,
    })
    .from(schema.modelPoseAssets)
    .leftJoin(defaultWorkflow, eq(schema.modelPoseAssets.workflowTemplateId, defaultWorkflow.id))
    .leftJoin(
      schema.poseGarmentConfigs,
      and(
        eq(schema.poseGarmentConfigs.poseAssetId, schema.modelPoseAssets.id),
        garmentTypeId
          ? eq(schema.poseGarmentConfigs.subcategoryId, garmentTypeId)
          : isNull(schema.poseGarmentConfigs.subcategoryId),
      ),
    )
    .leftJoin(
      overrideWorkflow,
      eq(schema.poseGarmentConfigs.workflowTemplateId, overrideWorkflow.id),
    )
    .where(inArray(schema.modelPoseAssets.id, poseIds));

  const poseWorkflows = poseWorkflowRows.map((r) => ({
    poseId: r.poseId,
    lowerNodeId: r.configWorkflowTemplateId != null ? r.overrideLowerNodeId : r.defaultLowerNodeId,
    shoeNodeId: r.configWorkflowTemplateId != null ? r.overrideShoeNodeId : r.defaultShoeNodeId,
    sizeNodeIds: r.configWorkflowTemplateId != null ? r.overrideSizeNodeIds : r.defaultSizeNodeIds,
  }));

  // Build map for O(1) lookup in the insert loop
  const poseWorkflowMap = new Map(poseWorkflows.map((pw) => [pw.poseId, pw]));

  for (const pw of poseWorkflows) {
    if (pw.lowerNodeId && !lowerCatalogId && !lowerGarmentKey) {
      throw new AppError('VALIDATION', 400, 'lower garment required for this pose');
    }
    if (pw.shoeNodeId && !shoeCatalogId) {
      throw new AppError('VALIDATION', 400, 'shoe catalog item required for this pose');
    }
  }

  const [[user], [planRow]] = await Promise.all([
    app.db.select().from(schema.users).where(eq(schema.users.id, userId)),
    app.db
      .select({ queueStream: schema.creditPlans.queueStream })
      .from(schema.users)
      .innerJoin(schema.creditPlans, eq(schema.users.tier, schema.creditPlans.slug))
      .where(eq(schema.users.id, userId)),
  ]);
  if (!user || user.isBanned) throw new AppError('FORBIDDEN', 403, 'banned');

  // Fall back to 'normal' if the user's tier has no matching credit_plans row.
  const queueStream: string = planRow?.queueStream ?? 'normal';
  const priority = queueStream === 'priority';

  const catalogueId = body.catalogueId ?? randomUUID();
  const jobIds = await app.db.transaction(async (tx) => {
    const created: string[] = [];
    for (const poseId of poseIds) {
      const pw = poseWorkflowMap.get(poseId);

      // Only store inputs the workflow actually supports — strips irrelevant fields
      // so the dispatcher never receives/resolves data it won't use.
      const effectiveLowerCatalogId =
        pw?.lowerNodeId && !lowerGarmentKey ? (lowerCatalogId ?? null) : null;
      const effectiveLowerGarmentKey = pw?.lowerNodeId && lowerGarmentKey ? lowerGarmentKey : null;
      const effectiveShoeCatalogId = pw?.shoeNodeId ? (shoeCatalogId ?? null) : null;
      // Always store aspectRatio — patcher gates on sizeNodeIds.length at dispatch time
      const effectiveAspectRatio = aspectRatio;

      const [job] = await tx
        .insert(schema.jobs)
        .values({
          userId,
          catalogueId,
          status: 'QUEUED',
          priority,
          creditsCharged: COST,
        })
        .returning();
      await atomicDeduct(tx as unknown as DB, userId, COST, job.id);
      await tx.insert(schema.jobInputs).values({
        jobId: job.id,
        upperGarmentKey,
        faceId,
        backgroundId: effectiveBackgroundId,
        poseId,
        garmentTypeId: garmentTypeId ?? null,
        lowerCatalogId: effectiveLowerCatalogId,
        lowerGarmentKey: effectiveLowerGarmentKey,
        shoeCatalogId: effectiveShoeCatalogId,
        userHint: promptGuard(body.userHint),
        params: {
          ...(body.params ?? {}),
          ...(effectiveAspectRatio ? { aspectRatio: effectiveAspectRatio } : {}),
          resolution,
          ...(platform ? { platform } : {}),
        },
      });
      created.push(job.id);
    }
    return created;
  });

  const stream = `jobs:${queueStream}`;
  const failedEnqueues: string[] = [];
  for (const jobId of jobIds) {
    try {
      await app.redis.xadd(stream, 'MAXLEN', '~', 10000, '*', 'jobId', jobId, 'userId', userId);
      jobsCreatedTotal.inc({ priority: queueStream });
    } catch (err) {
      app.log.error({ err, jobId }, 'redis xadd failed — job will be refunded');
      failedEnqueues.push(jobId);
    }
  }

  if (failedEnqueues.length > 0) {
    await Promise.all(
      failedEnqueues.map(async (jobId) => {
        await refund(app.db, userId, COST, jobId, 'REFUND_ENQUEUE_FAIL');
        await app.db
          .update(schema.jobs)
          .set({ status: 'FAILED', errorCode: 'ENQUEUE_FAIL' })
          .where(eq(schema.jobs.id, jobId));
      }),
    );
    if (failedEnqueues.length === jobIds.length) {
      throw new AppError('ENQUEUE_FAIL', 503, 'queue unavailable');
    }
  }

  return { catalogueId, jobIds };
}

export async function createSimpleTryonJob(
  app: FastifyInstance,
  userId: string,
  body: z.infer<typeof CreateSimpleTryonRequest>,
) {
  const { personKey, garmentKey, categoryId } = body;
  const COST = SIMPLE_TRYON_COST;

  await assertOwnsUploadKey(app, userId, personKey);
  await assertOwnsUploadKey(app, userId, garmentKey);

  const [[user], [planRow]] = await Promise.all([
    app.db.select().from(schema.users).where(eq(schema.users.id, userId)),
    app.db
      .select({ queueStream: schema.creditPlans.queueStream })
      .from(schema.users)
      .innerJoin(schema.creditPlans, eq(schema.users.tier, schema.creditPlans.slug))
      .where(eq(schema.users.id, userId)),
  ]);
  if (!user || user.isBanned) throw new AppError('FORBIDDEN', 403, 'banned');

  const queueStream: string = planRow?.queueStream ?? 'normal';
  const priority = queueStream === 'priority';

  // Resolve workflow template: category → its template → fallback to any active tryon template
  let workflowTemplateId: string;
  if (categoryId) {
    const [cat] = await app.db
      .select({ workflowTemplateId: schema.tryonCategories.workflowTemplateId })
      .from(schema.tryonCategories)
      .where(
        and(eq(schema.tryonCategories.id, categoryId), eq(schema.tryonCategories.isActive, true)),
      );
    if (cat?.workflowTemplateId) {
      workflowTemplateId = cat.workflowTemplateId;
    } else {
      const [tmpl] = await app.db
        .select({ id: schema.workflowTemplates.id })
        .from(schema.workflowTemplates)
        .where(
          and(
            eq(schema.workflowTemplates.workflowType, 'tryon'),
            eq(schema.workflowTemplates.isActive, true),
          ),
        )
        .limit(1);
      if (!tmpl) throw new AppError('CONFIG', 400, 'no active tryon workflow template configured');
      workflowTemplateId = tmpl.id;
    }
  } else {
    const [tmpl] = await app.db
      .select({ id: schema.workflowTemplates.id })
      .from(schema.workflowTemplates)
      .where(
        and(
          eq(schema.workflowTemplates.workflowType, 'tryon'),
          eq(schema.workflowTemplates.isActive, true),
        ),
      )
      .limit(1);
    if (!tmpl) throw new AppError('CONFIG', 400, 'no active tryon workflow template configured');
    workflowTemplateId = tmpl.id;
  }

  const catalogueId = randomUUID();
  const [job] = await app.db.transaction(async (tx) => {
    const [newJob] = await tx
      .insert(schema.jobs)
      .values({ userId, catalogueId, status: 'QUEUED', priority, creditsCharged: COST })
      .returning();
    await atomicDeduct(tx as unknown as DB, userId, COST, newJob.id);
    await tx.insert(schema.jobInputs).values({
      jobId: newJob.id,
      upperGarmentKey: garmentKey,
      params: { personKey, workflowTemplateId },
    });
    return [newJob];
  });

  const stream = `jobs:${queueStream}`;
  try {
    await app.redis.xadd(stream, 'MAXLEN', '~', 10000, '*', 'jobId', job.id, 'userId', userId);
    jobsCreatedTotal.inc({ priority: queueStream });
  } catch (err) {
    app.log.error({ err, jobId: job.id }, 'redis xadd failed — simple tryon job will be refunded');
    await refund(app.db, userId, COST, job.id, 'REFUND_ENQUEUE_FAIL');
    await app.db
      .update(schema.jobs)
      .set({ status: 'FAILED', errorCode: 'ENQUEUE_FAIL' })
      .where(eq(schema.jobs.id, job.id));
    throw new AppError('ENQUEUE_FAIL', 503, 'queue unavailable');
  }

  return { jobId: job.id, catalogueId };
}
