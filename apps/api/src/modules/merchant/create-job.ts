import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { ASPECT_DIMENSIONS, type Resolution, resolutionFromDims } from '@aivastra/types';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../../lib/errors.js';
import {
  getMaxOutputPx,
  getResolutionCreditCost,
  getTryonCreditCost,
} from '../../lib/resolution-config.js';
import { atomicDeduct } from '../credits/ledger.js';
import { assertMerchantUploadKey } from './upload-guard.js';

const CONFIG_KEY = 'config:system';

interface MerchantCatalogDefaults {
  merchantCatalogDefaults?: Partial<
    Record<'men' | 'women' | 'boys' | 'girls', { faceId: string; backgroundId: string }>
  >;
  merchantCatalogAspectRatio?: string;
}

/**
 * Builds an ordinary `jobs.userId`-owned studio job from admin-fixed inputs —
 * NOT a merchantId-owned job, NOT a new pipeline. This is the constrained
 * "Path B" generate: the merchant supplies only a flat garment image; face,
 * background, and pose are all server-resolved so every output is guaranteed
 * try-on-suitable. Deliberately NOT a refactor of jobs/create.ts::createJob
 * (that function is long, security-load-bearing — see its S1/S6/H2 comments —
 * and handles multi-pose/lower/shoe/Amazon cases this flow never needs).
 */
export async function createMerchantCatalogJob(
  app: FastifyInstance,
  params: {
    userId: string;
    garmentSubcategoryId: string;
    category: string;
    flatImageKey: string;
    subcategoryId: string;
    merchantId: string;
  },
): Promise<{ jobId: string }> {
  const [garmentType] = await app.db
    .select({
      defaultPoseId: schema.garmentSubcategories.defaultPoseId,
      requiresMannequinStep: schema.garmentSubcategories.requiresMannequinStep,
    })
    .from(schema.garmentSubcategories)
    .where(
      and(
        eq(schema.garmentSubcategories.id, params.garmentSubcategoryId),
        eq(schema.garmentSubcategories.isActive, true),
      ),
    )
    .limit(1);
  if (!garmentType) throw new AppError('BAD_CATALOG', 400, 'garment type not found or inactive');
  if (!garmentType.defaultPoseId) {
    throw new AppError(
      'VALIDATION',
      400,
      'admin has not configured a default pose for this garment type',
    );
  }

  const raw = await app.redis.get(CONFIG_KEY);
  const cfg = (raw ? JSON.parse(raw) : {}) as MerchantCatalogDefaults;
  const categoryDefaults =
    cfg.merchantCatalogDefaults?.[params.category as 'men' | 'women' | 'boys' | 'girls'];
  if (!categoryDefaults?.faceId || !categoryDefaults?.backgroundId) {
    throw new AppError(
      'VALIDATION',
      400,
      `admin has not configured default face/background for category "${params.category}"`,
    );
  }
  const aspectRatio = cfg.merchantCatalogAspectRatio ?? '2:3';

  const [face] = await app.db
    .select({ id: schema.modelFaces.id })
    .from(schema.modelFaces)
    .where(
      and(eq(schema.modelFaces.id, categoryDefaults.faceId), eq(schema.modelFaces.isActive, true)),
    );
  const [background] = await app.db
    .select({ id: schema.modelBackgrounds.id })
    .from(schema.modelBackgrounds)
    .where(
      and(
        eq(schema.modelBackgrounds.id, categoryDefaults.backgroundId),
        eq(schema.modelBackgrounds.isActive, true),
      ),
    );
  const [pose] = await app.db
    .select({ id: schema.modelPoseAssets.id })
    .from(schema.modelPoseAssets)
    .where(
      and(
        eq(schema.modelPoseAssets.id, garmentType.defaultPoseId),
        eq(schema.modelPoseAssets.isActive, true),
      ),
    );
  if (!face)
    throw new AppError('BAD_CATALOG', 400, 'configured default face not found or inactive');
  if (!background)
    throw new AppError('BAD_CATALOG', 400, 'configured default background not found or inactive');
  if (!pose)
    throw new AppError('BAD_CATALOG', 400, 'configured default pose not found or inactive');

  await assertMerchantUploadKey(app, params.merchantId, params.flatImageKey, 'flat garment');

  const requestedDims = ASPECT_DIMENSIONS[aspectRatio] ?? ASPECT_DIMENSIONS['2:3'];
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
  const cost = await getResolutionCreditCost(app, resolution);

  const jobId = randomUUID();
  await app.db.transaction(async (tx) => {
    await tx.insert(schema.jobs).values({
      id: jobId,
      userId: params.userId,
      status: 'QUEUED',
      // Merchant-generated catalogue images are never watermarked, regardless of
      // the user's plan tier — merchants are paying customers of a distinct product.
      watermark: false,
      queueStream: 'normal',
      creditsCharged: cost,
    });
    await atomicDeduct(tx as unknown as typeof app.db, params.userId, cost, jobId);
    await tx.insert(schema.jobInputs).values({
      jobId,
      upperGarmentKey: params.flatImageKey,
      faceId: face.id,
      backgroundId: background.id,
      poseId: pose.id,
      garmentTypeId: params.garmentSubcategoryId,
      params: {
        kind: 'merchant_catalog',
        subcategoryId: params.subcategoryId,
        outputWidth: outputDims.width,
        outputHeight: outputDims.height,
        aspectRatio,
        resolution,
        // The merchant's flatImageKey is always a raw, never-processed photo -
        // tells the dispatcher to run the mannequin compositing step inline
        // before the real generation. See apps/dispatcher/src/job/processor.ts's
        // requiresMannequinStep branch.
        needsMannequinStep: garmentType.requiresMannequinStep,
      },
    });
  });

  await app.redis.xadd(
    'jobs:normal',
    'MAXLEN',
    '~',
    10000,
    '*',
    'jobId',
    jobId,
    'userId',
    params.userId,
  );

  return { jobId };
}

/**
 * Mobile-only variant of createMerchantCatalogJob: finalizes the job with the
 * mannequin-drape (step 1) output directly, skipping step 2's pose/background/
 * face compositing entirely — so none of that admin config is required here.
 * Dispatches to the same `saree_mannequin` job kind the dev-API and Studio's
 * pre-resolution flow already use (see processSareeMannequinJob in
 * apps/dispatcher/src/job/processor.ts) — no dispatcher changes needed.
 *
 * faceId is always null: the mannequin workflow used for this garment type
 * bakes the face in via a fixed URL node, not a caller-supplied image.
 */
export async function createMerchantSareeMannequinJob(
  app: FastifyInstance,
  params: {
    userId: string;
    garmentSubcategoryId: string;
    flatImageKey: string;
    merchantId: string;
    sareeStyleId?: string;
  },
): Promise<{ jobId: string }> {
  const [garmentType] = await app.db
    .select({
      requiresMannequinStep: schema.garmentSubcategories.requiresMannequinStep,
      mannequinWorkflowTemplateId: schema.garmentSubcategories.mannequinWorkflowTemplateId,
      isActive: schema.garmentSubcategories.isActive,
    })
    .from(schema.garmentSubcategories)
    .where(eq(schema.garmentSubcategories.id, params.garmentSubcategoryId))
    .limit(1);
  if (!garmentType?.isActive) {
    throw new AppError('BAD_CATALOG', 400, 'garment type not found or inactive');
  }
  if (!garmentType.requiresMannequinStep || !garmentType.mannequinWorkflowTemplateId) {
    throw new AppError('VALIDATION', 400, 'this garment type does not use the mannequin step');
  }

  let styleWorkflowTemplateId: string | undefined;
  if (params.sareeStyleId) {
    const [style] = await app.db
      .select({
        isActive: schema.sareeMannequinStyles.isActive,
        mannequinWorkflowTemplateId: schema.sareeMannequinStyles.mannequinWorkflowTemplateId,
      })
      .from(schema.sareeMannequinStyles)
      .where(eq(schema.sareeMannequinStyles.id, params.sareeStyleId))
      .limit(1);
    if (!style?.isActive) {
      throw new AppError('BAD_STYLE', 400, 'saree style not found or inactive');
    }
    styleWorkflowTemplateId = style.mannequinWorkflowTemplateId;
  }

  await assertMerchantUploadKey(app, params.merchantId, params.flatImageKey, 'flat garment');

  const cost = await getTryonCreditCost(app);

  const jobId = randomUUID();
  await app.db.transaction(async (tx) => {
    await tx.insert(schema.jobs).values({
      id: jobId,
      userId: params.userId,
      status: 'QUEUED',
      watermark: false,
      queueStream: 'normal',
      creditsCharged: cost,
    });
    await atomicDeduct(tx as unknown as typeof app.db, params.userId, cost, jobId);
    await tx.insert(schema.jobInputs).values({
      jobId,
      upperGarmentKey: params.flatImageKey,
      faceId: null,
      garmentTypeId: params.garmentSubcategoryId,
      params: {
        kind: 'saree_mannequin',
        ...(styleWorkflowTemplateId ? { workflowTemplateId: styleWorkflowTemplateId } : {}),
      },
    });
  });

  await app.redis.xadd(
    'jobs:normal',
    'MAXLEN',
    '~',
    10000,
    '*',
    'jobId',
    jobId,
    'userId',
    params.userId,
  );

  return { jobId };
}
export async function createMerchantSareeMannequinJob1(
  app: FastifyInstance,
  params: {
    userId: string;
    garmentSubcategoryId: string;
    flatImageKey: string;
    merchantId: string;
    sareeStyleId?: string;
  },
): Promise<{ jobId: string }> {
  const [garmentType] = await app.db
    .select({
      requiresMannequinStep: schema.garmentSubcategories.requiresMannequinStep,
      mannequinWorkflowTemplateId: schema.garmentSubcategories.mannequinWorkflowTemplateId,
      isActive: schema.garmentSubcategories.isActive,
    })
    .from(schema.garmentSubcategories)
    .where(eq(schema.garmentSubcategories.id, params.garmentSubcategoryId))
    .limit(1);
  if (!garmentType?.isActive) {
    throw new AppError('BAD_CATALOG', 400, 'garment type not found or inactive');
  }
  if (!garmentType.requiresMannequinStep || !garmentType.mannequinWorkflowTemplateId) {
    throw new AppError('VALIDATION', 400, 'this garment type does not use the mannequin step');
  }

  let styleWorkflowTemplateId: string | undefined;
  if (params.sareeStyleId) {
    const [style] = await app.db
      .select({
        isActive: schema.sareeMannequinStyles.isActive,
        mannequinWorkflowTemplateId: schema.sareeMannequinStyles.mannequinWorkflowTemplateId,
      })
      .from(schema.sareeMannequinStyles)
      .where(eq(schema.sareeMannequinStyles.id, params.sareeStyleId))
      .limit(1);
    if (!style?.isActive) {
      throw new AppError('BAD_STYLE', 400, 'saree style not found or inactive');
    }
    styleWorkflowTemplateId = '500cd876-9f96-4daf-a266-3091af282cda';
  }

  await assertMerchantUploadKey(app, params.merchantId, params.flatImageKey, 'flat garment');

  const cost = await getTryonCreditCost(app);

  const jobId = randomUUID();
  await app.db.transaction(async (tx) => {
    await tx.insert(schema.jobs).values({
      id: jobId,
      userId: params.userId,
      status: 'QUEUED',
      watermark: false,
      queueStream: 'normal',
      creditsCharged: cost,
    });
    await atomicDeduct(tx as unknown as typeof app.db, params.userId, cost, jobId);
    await tx.insert(schema.jobInputs).values({
      jobId,
      upperGarmentKey: params.flatImageKey,
      faceId: null,
      garmentTypeId: params.garmentSubcategoryId,
      params: {
        kind: 'saree_mannequin',
        ...(styleWorkflowTemplateId ? { workflowTemplateId: styleWorkflowTemplateId } : {}),
      },
    });
  });

  await app.redis.xadd(
    'jobs:normal',
    'MAXLEN',
    '~',
    10000,
    '*',
    'jobId',
    jobId,
    'userId',
    params.userId,
  );

  return { jobId };
}
