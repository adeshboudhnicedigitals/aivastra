import { schema } from '@aivastra/db';
import type {
  CreateSareeJobRequest,
  CreateSimpleTryonRequest,
  CreateTryOnJobRequest,
  Resolution,
} from '@aivastra/types';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { createJob, createSimpleTryonJob } from './create.js';
import { createSareeJob } from './createSaree.js';

/**
 * Regenerate = a brand-new job, billed and validated exactly like a fresh
 * request. This delegates to the same createJob/createSimpleTryonJob/
 * createSareeJob helpers the real routes use — per spec, pricing, watermark
 * entitlement, and catalog/pose-workflow validation must never be
 * special-cased here, or the two paths will silently drift apart.
 */
export async function regenerateJob(app: FastifyInstance, userId: string, originalJobId: string) {
  const [original] = await app.db
    .select({ job: schema.jobs, inputs: schema.jobInputs })
    .from(schema.jobs)
    .innerJoin(schema.jobInputs, eq(schema.jobs.id, schema.jobInputs.jobId))
    .where(eq(schema.jobs.id, originalJobId));

  if (!original) throw new AppError('NOT_FOUND', 404, 'job not found');
  if (original.job.userId !== userId) throw new AppError('NOT_FOUND', 404, 'job not found');
  if (original.job.status !== 'COMPLETED') {
    throw new AppError('CONFLICT', 409, 'can only regenerate completed jobs');
  }

  const { inputs } = original;
  const params = (inputs.params ?? {}) as Record<string, unknown>;
  const isSaree = params.kind === 'saree';
  const isTryonDirect = typeof params.personKey === 'string';

  if (isSaree) {
    if (!inputs.upperGarmentKey) {
      throw new AppError('VALIDATION', 400, 'original job has no garment to regenerate');
    }
    const body: z.infer<typeof CreateSareeJobRequest> = { garmentKey: inputs.upperGarmentKey };
    const result = await createSareeJob(app, userId, body);
    await setParentJobId(app, result.jobId, originalJobId);
    return { jobId: result.jobId, catalogueId: result.catalogueId };
  }

  if (isTryonDirect) {
    const { personKey, sourceJobId } = params;
    if (typeof personKey !== 'string' || typeof sourceJobId !== 'string') {
      throw new AppError(
        'VALIDATION',
        400,
        'this job cannot be regenerated — missing source reference',
      );
    }
    const body: z.infer<typeof CreateSimpleTryonRequest> = { personKey, sourceJobId };
    const result = await createSimpleTryonJob(app, userId, body);
    await setParentJobId(app, result.jobId, originalJobId);
    return { jobId: result.jobId, catalogueId: result.catalogueId };
  }

  // Studio/catalogue job — one poseId per job row, reconstruct the multi-pose
  // request shape createJob expects with just that single pose.
  if (!inputs.poseId || !inputs.faceId || !inputs.backgroundId) {
    throw new AppError('VALIDATION', 400, 'original job is missing required inputs to regenerate');
  }
  const mappingId =
    typeof params.catalogueTemplateMappingId === 'string'
      ? params.catalogueTemplateMappingId
      : undefined;
  if (mappingId && !inputs.garmentTypeId) {
    throw new AppError(
      'VALIDATION',
      400,
      'mapped original job is missing its garment type and cannot be regenerated',
    );
  }

  const trustedGarmentKeys = new Set<string>();
  if (inputs.upperGarmentKey) trustedGarmentKeys.add(inputs.upperGarmentKey);
  if (inputs.lowerGarmentKey) trustedGarmentKeys.add(inputs.lowerGarmentKey);

  const body: z.infer<typeof CreateTryOnJobRequest> = {
    catalogueId: original.job.catalogueId ?? undefined,
    inputs: {
      upperGarmentKey: inputs.upperGarmentKey ?? undefined,
      faceId: inputs.faceId,
      garmentTypeId: inputs.garmentTypeId ?? undefined,
      lowerCatalogId: inputs.lowerCatalogId ?? undefined,
      lowerGarmentKey: inputs.lowerGarmentKey ?? undefined,
      shoeCatalogId: inputs.shoeCatalogId ?? undefined,
      ...(mappingId
        ? {
            catalogueTemplateMappingId: mappingId,
            looks: [{ poseId: inputs.poseId, backgroundId: inputs.backgroundId }],
          }
        : { backgroundId: inputs.backgroundId, poseIds: [inputs.poseId] }),
    },
    params: {
      outputWidth: typeof params.outputWidth === 'number' ? params.outputWidth : undefined,
      outputHeight: typeof params.outputHeight === 'number' ? params.outputHeight : undefined,
    },
    userHint: inputs.userHint ?? undefined,
    aspectRatio: (typeof params.aspectRatio === 'string' ? params.aspectRatio : '1:1') as z.infer<
      typeof CreateTryOnJobRequest
    >['aspectRatio'],
    resolution: (typeof params.resolution === 'string' ? params.resolution : '2K') as Resolution,
    platform: typeof params.platform === 'string' ? params.platform : undefined,
  };

  const result = await createJob(app, userId, body, { trustedGarmentKeys });
  const newJobId = result.jobIds[0];
  await setParentJobId(app, newJobId, originalJobId);
  return { jobId: newJobId, catalogueId: result.catalogueId };
}

async function setParentJobId(app: FastifyInstance, jobId: string, parentJobId: string) {
  await app.db.update(schema.jobs).set({ parentJobId }).where(eq(schema.jobs.id, jobId));
}
