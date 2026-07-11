import { randomUUID } from 'node:crypto';
import { type DB, schema } from '@aivastra/db';
import { jobsCreatedTotal } from '@aivastra/observability';
import { keys } from '@aivastra/storage';
import {
  ASPECT_DIMENSIONS,
  type CreateSimpleTryonRequest,
  type CreateTryOnJobRequest,
  type Resolution,
  resolutionFromDims,
} from '@aivastra/types';
import { aliasedTable, and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import {
  getMaxOutputPx,
  getResolutionCreditCost,
  getTryonCreditCost,
} from '../../lib/resolution-config.js';
import { atomicDeduct, refund } from '../credits/ledger.js';
import { getSareeSettings } from '../saree/settings.js';
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
export async function assertOwnsUploadKey(app: FastifyInstance, userId: string, key: string) {
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
  const { faceId, garmentTypeId, upperGarmentKey, lowerCatalogId, lowerGarmentKey, shoeCatalogId } =
    body.inputs;
  const aspectRatio: string | undefined = body.aspectRatio;
  const platform: string | undefined = body.platform;

  // S1: compute cost server-side from actual output dims — never trust client's `resolution`.
  const customW = body.params?.outputWidth;
  const customH = body.params?.outputHeight;
  const requestedDims =
    customW && customH
      ? { width: customW, height: customH }
      : (ASPECT_DIMENSIONS[body.aspectRatio] ?? { width: 2048, height: 2048 });
  // Platform-wide resolution ceiling — admin-configured, not per-workflow (see
  // getMaxOutputPx). Only downscale, and only the long edge exceeding it; the
  // dispatcher patches the workflow with whatever dims land in job_inputs.params,
  // so this is the single enforcement point.
  const maxOutputPx = await getMaxOutputPx(app);
  const requestedLongEdge = Math.max(requestedDims.width, requestedDims.height);
  const outputDims =
    requestedLongEdge > maxOutputPx
      ? requestedDims.width >= requestedDims.height
        ? {
            width: maxOutputPx,
            height: Math.round(maxOutputPx * (requestedDims.height / requestedDims.width)),
          }
        : {
            width: Math.round(maxOutputPx * (requestedDims.width / requestedDims.height)),
            height: maxOutputPx,
          }
      : requestedDims;
  const resolution: Resolution = resolutionFromDims(outputDims.width, outputDims.height);
  const COST = await getResolutionCreditCost(app, resolution);

  // H2: keys are format-pinned by zod, but the format alone does not prove the
  // caller owns the object — another user's key has the same shape. Verify each
  // garment key was issued to THIS user by /v1/uploads/presign (Redis binding)
  // before any credit/DB mutation.
  await assertOwnsUploadKey(app, userId, upperGarmentKey);
  if (lowerGarmentKey) await assertOwnsUploadKey(app, userId, lowerGarmentKey);

  // Normalize to a single per-look list. Exactly one of (backgroundId + poseIds) or
  // looks is present — enforced by CreateTryOnJobInputs's zod .refine() — but the
  // check is repeated here since TS can't see that constraint through the optional
  // fields on body.inputs.
  const legacyBackgroundId = body.inputs.backgroundId;
  const legacyPoseIds = body.inputs.poseIds;
  const templateLooks = body.inputs.looks;
  if (!templateLooks && !(legacyBackgroundId && legacyPoseIds)) {
    throw new AppError(
      'VALIDATION',
      400,
      'inputs must include either backgroundId+poseIds or looks',
    );
  }

  let looks: Array<{ poseId: string; backgroundId: string }>;
  if (templateLooks) {
    // Per-look backgrounds are authoritative for templates — the Amazon white-bg
    // override below must never run for this form.
    looks = templateLooks;
  } else {
    // Amazon platform requires a white background — override the single shared
    // background with the one tagged isWhiteBg in the admin panel. Only applies
    // to the legacy form; template backgrounds are never overridden.
    let effectiveBackgroundId = legacyBackgroundId as string;
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
        { originalBg: legacyBackgroundId, amazonBg: effectiveBackgroundId, platform },
        'amazon bg override',
      );
    }
    looks = (legacyPoseIds as string[]).map((poseId) => ({
      poseId,
      backgroundId: effectiveBackgroundId,
    }));
  }

  const dedupeKeys = new Set(looks.map((l) => `${l.poseId}::${l.backgroundId}`));
  if (dedupeKeys.size !== looks.length) {
    throw new AppError('VALIDATION', 400, 'duplicate pose+background combination in looks');
  }

  const distinctPoseIds = Array.from(new Set(looks.map((l) => l.poseId)));
  const distinctBackgroundIds = Array.from(new Set(looks.map((l) => l.backgroundId)));

  const [face, backgroundRows, poses] = await Promise.all([
    app.db
      .select({ id: schema.modelFaces.id })
      .from(schema.modelFaces)
      .where(and(eq(schema.modelFaces.id, faceId), eq(schema.modelFaces.isActive, true))),
    app.db
      .select({ id: schema.modelBackgrounds.id })
      .from(schema.modelBackgrounds)
      .where(
        and(
          inArray(schema.modelBackgrounds.id, distinctBackgroundIds),
          eq(schema.modelBackgrounds.isActive, true),
        ),
      ),
    app.db
      .select({ id: schema.modelPoseAssets.id })
      .from(schema.modelPoseAssets)
      .where(
        and(
          inArray(schema.modelPoseAssets.id, distinctPoseIds),
          eq(schema.modelPoseAssets.isActive, true),
          isNull(schema.modelPoseAssets.deletedAt),
        ),
      ),
  ]);

  if (!face[0]) throw new AppError('BAD_CATALOG', 400, 'face not found or inactive');
  if (backgroundRows.length !== distinctBackgroundIds.length)
    throw new AppError('BAD_CATALOG', 400, 'one or more backgrounds not found or inactive');
  if (poses.length !== distinctPoseIds.length)
    throw new AppError('BAD_CATALOG', 400, 'one or more poses not found or inactive');

  // S6: validate optional catalog IDs so the dispatcher never silently falls back
  // on a bad ID that slipped through as null.
  const catalogChecks = await Promise.all([
    lowerCatalogId
      ? app.db
          .select({ id: schema.catalogItems.id })
          .from(schema.catalogItems)
          .where(
            and(eq(schema.catalogItems.id, lowerCatalogId), eq(schema.catalogItems.isActive, true)),
          )
      : Promise.resolve([{ id: lowerCatalogId }]),
    shoeCatalogId
      ? app.db
          .select({ id: schema.catalogItems.id })
          .from(schema.catalogItems)
          .where(
            and(eq(schema.catalogItems.id, shoeCatalogId), eq(schema.catalogItems.isActive, true)),
          )
      : Promise.resolve([{ id: shoeCatalogId }]),
    garmentTypeId
      ? app.db
          .select({ id: schema.garmentSubcategories.id })
          .from(schema.garmentSubcategories)
          .where(
            and(
              eq(schema.garmentSubcategories.id, garmentTypeId),
              eq(schema.garmentSubcategories.isActive, true),
            ),
          )
      : Promise.resolve([{ id: garmentTypeId }]),
  ]);
  if (lowerCatalogId && !catalogChecks[0]?.[0])
    throw new AppError('BAD_CATALOG', 400, 'lower catalog item not found or inactive');
  if (shoeCatalogId && !catalogChecks[1]?.[0])
    throw new AppError('BAD_CATALOG', 400, 'shoe catalog item not found or inactive');
  if (garmentTypeId && !catalogChecks[2]?.[0])
    throw new AppError('BAD_CATALOG', 400, 'garment type not found or inactive');

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
      configIsActive: schema.poseGarmentConfigs.isActive,
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
    .where(inArray(schema.modelPoseAssets.id, distinctPoseIds));

  // A per-garment-type active override can hide a pose for this garment type
  // specifically (see /v1/models/poses) — reject here too so a stale client can't
  // submit a job for a pose+garmentType combo the admin explicitly disabled.
  if (garmentTypeId && poseWorkflowRows.some((r) => r.configIsActive === false)) {
    throw new AppError('BAD_CATALOG', 400, 'one or more poses not found or inactive');
  }

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
      .select({
        queueStream: schema.creditPlans.queueStream,
        watermark: schema.creditPlans.watermark,
      })
      .from(schema.users)
      .innerJoin(schema.creditPlans, eq(schema.users.tier, schema.creditPlans.slug))
      .where(eq(schema.users.id, userId)),
  ]);
  if (!user || user.isBanned) throw new AppError('FORBIDDEN', 403, 'banned');

  // Fall back to 'normal' if the user's tier has no matching credit_plans row.
  const queueStream: string = planRow?.queueStream ?? 'normal';
  const priority = queueStream === 'priority';
  // Snapshot watermark entitlement from the plan at job creation time.
  // Never re-derived after this point — see spec precedence rule.
  const watermark: boolean = planRow?.watermark ?? false;

  const catalogueId = body.catalogueId ?? randomUUID();
  const jobIds = await app.db.transaction(async (tx) => {
    const created: string[] = [];
    for (const look of looks) {
      const pw = poseWorkflowMap.get(look.poseId);

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
          queueStream,
          watermark,
          creditsCharged: COST,
          source: 'catalog',
        })
        .returning();
      await atomicDeduct(tx as unknown as DB, userId, COST, job.id);
      await tx.insert(schema.jobInputs).values({
        jobId: job.id,
        upperGarmentKey,
        faceId,
        backgroundId: look.backgroundId,
        poseId: look.poseId,
        garmentTypeId: garmentTypeId ?? null,
        lowerCatalogId: effectiveLowerCatalogId,
        lowerGarmentKey: effectiveLowerGarmentKey,
        shoeCatalogId: effectiveShoeCatalogId,
        userHint: promptGuard(body.userHint),
        params: {
          ...(body.params ?? {}),
          // Always the clamped, server-computed dims — whether derived from the
          // aspect-ratio enum or a custom request, this is what the dispatcher
          // patches the workflow with. Never let a raw pre-maxOutputPx value through.
          outputWidth: outputDims.width,
          outputHeight: outputDims.height,
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
      jobsCreatedTotal.inc({ priority: queueStream, kind: 'catalogue' });
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
  const { personKey, sourceJobId } = body;
  const COST = await getTryonCreditCost(app);

  await assertOwnsUploadKey(app, userId, personKey);

  // Resolve the source image's workflow template. For Studio jobs this goes
  // through the garment type → tryon category chain; for saree catalogue jobs
  // it reads from saree_settings.workflowTemplateId.
  const [source] = await app.db
    .select({
      jobUserId: schema.jobs.userId,
      jobStatus: schema.jobs.status,
      garmentTypeId: schema.jobInputs.garmentTypeId,
      kind: sql<string>`${schema.jobInputs.params}->>'kind'`.as('kind'),
      workflowTemplateId: schema.tryonCategories.workflowTemplateId,
      tryonCategoryIsActive: schema.tryonCategories.isActive,
      workflowTemplateIsActive: schema.workflowTemplates.isActive,
    })
    .from(schema.jobs)
    .innerJoin(schema.jobInputs, eq(schema.jobInputs.jobId, schema.jobs.id))
    .leftJoin(
      schema.garmentSubcategories,
      eq(schema.garmentSubcategories.id, schema.jobInputs.garmentTypeId),
    )
    .leftJoin(
      schema.tryonCategories,
      eq(schema.tryonCategories.id, schema.garmentSubcategories.tryonCategoryId),
    )
    .leftJoin(
      schema.workflowTemplates,
      eq(schema.workflowTemplates.id, schema.tryonCategories.workflowTemplateId),
    )
    .where(eq(schema.jobs.id, sourceJobId));

  if (!source) throw new AppError('NOT_FOUND', 404, 'source image not found');
  if (source.jobUserId !== userId) {
    throw new AppError('FORBIDDEN', 403, 'source image not owned by caller');
  }
  if (source.jobStatus !== 'COMPLETED') {
    throw new AppError('VALIDATION', 400, 'source image is not a completed job');
  }

  let workflowTemplateId: string;

  if (source.kind === 'saree') {
    const sareeSettings = await getSareeSettings(app.db);
    if (!sareeSettings?.workflowTemplateId) {
      throw new AppError('VALIDATION', 400, 'saree tryon workflow not configured by admin');
    }
    const [wf] = await app.db
      .select({ isActive: schema.workflowTemplates.isActive })
      .from(schema.workflowTemplates)
      .where(
        and(
          eq(schema.workflowTemplates.id, sareeSettings.workflowTemplateId),
          eq(schema.workflowTemplates.isActive, true),
        ),
      );
    if (!wf) {
      throw new AppError('VALIDATION', 400, 'saree tryon workflow is not active');
    }
    workflowTemplateId = sareeSettings.workflowTemplateId;
  } else {
    // Kill-switch parity: a tryon category (or its workflow template) that an admin
    // deactivated after garment types were mapped to it must not resolve.
    if (
      !source.workflowTemplateId ||
      !source.tryonCategoryIsActive ||
      !source.workflowTemplateIsActive
    ) {
      throw new AppError('VALIDATION', 400, 'garment type has no tryon category configured');
    }
    workflowTemplateId = source.workflowTemplateId;
  }

  const garmentKey = keys.output(sourceJobId);

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

  const catalogueId = randomUUID();
  const [job] = await app.db.transaction(async (tx) => {
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
        source: 'tryon',
      })
      .returning();
    await atomicDeduct(tx as unknown as DB, userId, COST, newJob.id);
    await tx.insert(schema.jobInputs).values({
      jobId: newJob.id,
      upperGarmentKey: garmentKey,
      garmentTypeId: source.garmentTypeId,
      // sourceJobId is stored (not just resolved into garmentKey) so a later
      // regenerate can re-derive the garment from the CURRENT output of the
      // source job, exactly as a fresh request would, instead of needing a
      // separate code path.
      params: { personKey, workflowTemplateId, sourceJobId },
    });
    return [newJob];
  });

  const stream = `jobs:${queueStream}`;
  try {
    await app.redis.xadd(stream, 'MAXLEN', '~', 10000, '*', 'jobId', job.id, 'userId', userId);
    jobsCreatedTotal.inc({ priority: queueStream, kind: 'tryon' });
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
