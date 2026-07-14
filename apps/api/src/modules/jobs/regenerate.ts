import { schema } from '@aivastra/db';
import type { CreateSimpleTryonRequest, CreateTryOnJobRequest, Resolution } from '@aivastra/types';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { createJob, createSimpleTryonJob } from './create.js';

/**
 * Regenerate = a brand-new job, billed and validated exactly like a fresh
 * request. This delegates to the same createJob/createSimpleTryonJob
 * helpers the real routes use — per spec, pricing, watermark
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
  const isTryonDirect = typeof params.personKey === 'string';

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
  if (!inputs.poseId || !inputs.faceId || !inputs.backgroundId || !inputs.upperGarmentKey) {
    throw new AppError('VALIDATION', 400, 'original job is missing required inputs to regenerate');
  }
  const body: z.infer<typeof CreateTryOnJobRequest> = {
    catalogueId: original.job.catalogueId ?? undefined,
    inputs: {
      upperGarmentKey: inputs.upperGarmentKey,
      faceId: inputs.faceId,
      backgroundId: inputs.backgroundId,
      poseIds: [inputs.poseId],
      garmentTypeId: inputs.garmentTypeId ?? undefined,
      lowerCatalogId: inputs.lowerCatalogId ?? undefined,
      lowerGarmentKey: inputs.lowerGarmentKey ?? undefined,
      shoeCatalogId: inputs.shoeCatalogId ?? undefined,
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

  const result = await createJob(app, userId, body);
  const newJobId = result.jobIds[0];
  await setParentJobId(app, newJobId, originalJobId);
  return { jobId: newJobId, catalogueId: result.catalogueId };
}

async function setParentJobId(app: FastifyInstance, jobId: string, parentJobId: string) {
  await app.db.update(schema.jobs).set({ parentJobId }).where(eq(schema.jobs.id, jobId));
}
