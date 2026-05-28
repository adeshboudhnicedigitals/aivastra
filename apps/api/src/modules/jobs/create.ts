import { type DB, schema } from '@aivastra/db';
import { randomUUID } from 'crypto';
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../../lib/errors.js';
import { atomicDeduct, refund } from '../credits/ledger.js';
import { promptGuard } from './sanitize.js';

const COST = 1;

export async function createJob(app: FastifyInstance, userId: string, body: any) {
  const { faceId, backgroundId, poseIds, upperGarmentKey, lowerCatalogId, shoeCatalogId } =
    body.inputs;
  const aspectRatio: string | undefined = body.aspectRatio;

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
          eq(schema.modelBackgrounds.id, backgroundId),
          eq(schema.modelBackgrounds.isActive, true),
        ),
      ),
    app.db
      .select({ id: schema.modelPoses.id })
      .from(schema.modelPoses)
      .where(and(inArray(schema.modelPoses.id, poseIds), eq(schema.modelPoses.isActive, true))),
  ]);

  if (!face[0]) throw new AppError('BAD_CATALOG', 400, 'face not found or inactive');
  if (!background[0]) throw new AppError('BAD_CATALOG', 400, 'background not found or inactive');
  if (poses.length !== poseIds.length)
    throw new AppError('BAD_CATALOG', 400, 'one or more poses not found or inactive');

  const [user] = await app.db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!user || user.isBanned) throw new AppError('FORBIDDEN', 403, 'banned');
  const priority = user.tier === 'PRO';

  const catalogueId = randomUUID();
  const jobIds = await app.db.transaction(async (tx) => {
    const created: string[] = [];
    for (const poseId of poseIds) {
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
        backgroundId,
        poseId,
        lowerCatalogId: lowerCatalogId ?? null,
        shoeCatalogId: shoeCatalogId ?? null,
        userHint: promptGuard(body.userHint),
        params: { ...(body.params ?? {}), ...(aspectRatio ? { aspectRatio } : {}) },
      });
      created.push(job.id);
    }
    return created;
  });

  const stream = priority ? 'jobs:priority' : 'jobs:normal';
  const failedEnqueues: string[] = [];
  for (const jobId of jobIds) {
    try {
      await app.redis.xadd(stream, '*', 'jobId', jobId, 'userId', userId);
    } catch {
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
