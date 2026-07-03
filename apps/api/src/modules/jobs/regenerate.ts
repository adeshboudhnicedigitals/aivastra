import { randomUUID } from 'node:crypto';
import type { DB } from '@aivastra/db';
import { schema } from '@aivastra/db';
import { jobsCreatedTotal } from '@aivastra/observability';
import { SIMPLE_TRYON_COST, type Resolution } from '@aivastra/types';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../../lib/errors.js';
import { atomicDeduct, refund } from '../credits/ledger.js';
import { getResolutionCreditCost } from '../../lib/resolution-config.js';
import { assertOwnsUploadKey } from './create.js';

export async function regenerateJob(app: FastifyInstance, userId: string, originalJobId: string) {
  // 1. Load original job + job_inputs.
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
  const isSaree = (inputs.params as any)?.kind === 'saree';
  const isTryonDirect = !!(inputs.params as any)?.personKey;

  let COST = SIMPLE_TRYON_COST;
  if (!isSaree && !isTryonDirect) {
    const resolution = (inputs.params as any)?.resolution ?? '2K';
    COST = await getResolutionCreditCost(app, resolution);
  }

  // 2. Re-validate every referenced ID
  if (inputs.upperGarmentKey) {
    await assertOwnsUploadKey(app, userId, inputs.upperGarmentKey);
  }
  if (inputs.lowerGarmentKey) {
    await assertOwnsUploadKey(app, userId, inputs.lowerGarmentKey);
  }
  if (inputs.faceId) {
    const [face] = await app.db.select({ id: schema.modelFaces.id }).from(schema.modelFaces).where(and(eq(schema.modelFaces.id, inputs.faceId), eq(schema.modelFaces.isActive, true)));
    if (!face) throw new AppError('VALIDATION', 400, 'referenced face is no longer available');
  }
  if (inputs.backgroundId) {
    const [bg] = await app.db.select({ id: schema.modelBackgrounds.id }).from(schema.modelBackgrounds).where(and(eq(schema.modelBackgrounds.id, inputs.backgroundId), eq(schema.modelBackgrounds.isActive, true)));
    if (!bg) throw new AppError('VALIDATION', 400, 'referenced background is no longer available');
  }
  if (inputs.poseId) {
    const [pose] = await app.db.select({ id: schema.modelPoseAssets.id }).from(schema.modelPoseAssets).where(and(eq(schema.modelPoseAssets.id, inputs.poseId), eq(schema.modelPoseAssets.isActive, true)));
    if (!pose) throw new AppError('VALIDATION', 400, 'referenced pose is no longer available');
  }
  if (inputs.garmentTypeId) {
    const [cat] = await app.db.select({ id: schema.garmentSubcategories.id }).from(schema.garmentSubcategories).where(eq(schema.garmentSubcategories.id, inputs.garmentTypeId));
    if (!cat) throw new AppError('VALIDATION', 400, 'referenced garment category is no longer available');
  }
  if (inputs.lowerCatalogId) {
    const [cat] = await app.db.select({ id: schema.catalogItems.id }).from(schema.catalogItems).where(and(eq(schema.catalogItems.id, inputs.lowerCatalogId), eq(schema.catalogItems.isActive, true)));
    if (!cat) throw new AppError('VALIDATION', 400, 'referenced lower catalog item is no longer available');
  }
  if (inputs.shoeCatalogId) {
    const [cat] = await app.db.select({ id: schema.catalogItems.id }).from(schema.catalogItems).where(and(eq(schema.catalogItems.id, inputs.shoeCatalogId), eq(schema.catalogItems.isActive, true)));
    if (!cat) throw new AppError('VALIDATION', 400, 'referenced shoe catalog item is no longer available');
  }

  // 3. Resolve current pricing and watermark entitlement
  const [[user], [planRow]] = await Promise.all([
    app.db.select().from(schema.users).where(eq(schema.users.id, userId)),
    app.db
      .select({ queueStream: schema.creditPlans.queueStream, watermark: schema.creditPlans.watermark })
      .from(schema.users)
      .innerJoin(schema.creditPlans, eq(schema.users.tier, schema.creditPlans.slug))
      .where(eq(schema.users.id, userId)),
  ]);
  if (!user || user.isBanned) throw new AppError('FORBIDDEN', 403, 'banned');

  const queueStream: string = planRow?.queueStream ?? 'normal';
  const priority = queueStream === 'priority';
  const watermark: boolean = planRow?.watermark ?? false;

  // 4. Deduct credits and insert
  const newJobId = await app.db.transaction(async (tx) => {
    const [newJob] = await tx
      .insert(schema.jobs)
      .values({
        userId,
        catalogueId: original.job.catalogueId,
        status: 'QUEUED',
        priority,
        queueStream,
        watermark,
        creditsCharged: COST,
        parentJobId: originalJobId,
        widgetClientId: original.job.widgetClientId,
        customerPhotoKey: original.job.customerPhotoKey,
      })
      .returning();

    await atomicDeduct(tx as unknown as DB, userId, COST, newJob.id);

    await tx.insert(schema.jobInputs).values({
      jobId: newJob.id,
      upperGarmentKey: inputs.upperGarmentKey,
      faceId: inputs.faceId,
      backgroundId: inputs.backgroundId,
      poseId: inputs.poseId,
      garmentTypeId: inputs.garmentTypeId,
      lowerCatalogId: inputs.lowerCatalogId,
      lowerGarmentKey: inputs.lowerGarmentKey,
      shoeCatalogId: inputs.shoeCatalogId,
      userHint: inputs.userHint,
      params: inputs.params,
    });

    return newJob.id;
  });

  // 5. Enqueue normally
  const stream = `jobs:${queueStream}`;
  const kind = isSaree ? 'saree' : isTryonDirect ? 'tryon' : 'catalogue';
  try {
    await app.redis.xadd(stream, 'MAXLEN', '~', 10000, '*', 'jobId', newJobId, 'userId', userId);
    jobsCreatedTotal.inc({ priority: queueStream, kind });
  } catch (err) {
    app.log.error({ err, jobId: newJobId }, 'redis xadd failed — regenerated job will be refunded');
    await refund(app.db, userId, COST, newJobId, 'REFUND_ENQUEUE_FAIL');
    await app.db
      .update(schema.jobs)
      .set({ status: 'FAILED', errorCode: 'ENQUEUE_FAIL' })
      .where(eq(schema.jobs.id, newJobId));
    throw new AppError('ENQUEUE_FAIL', 503, 'queue unavailable');
  }

  return { jobId: newJobId, catalogueId: original.job.catalogueId };
}
