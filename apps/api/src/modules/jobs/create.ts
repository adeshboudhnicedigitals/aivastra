import type { FastifyInstance } from 'fastify';
import { schema, type DB } from '@aivastra/db';
import { eq, and, inArray } from 'drizzle-orm';
import { AppError } from '../../lib/errors';
import { atomicDeduct, refund } from '../credits/ledger';
import { promptGuard } from './sanitize';

const COST = 1;

export async function createJob(app: FastifyInstance, userId: string, body: any) {
  const ids = [body.inputs.modelCatalogId, body.inputs.poseCatalogId,
               body.inputs.backgroundCatalogId, body.inputs.lowerCatalogId];
  const items = await app.db.select().from(schema.catalogItems)
    .where(and(inArray(schema.catalogItems.id, ids), eq(schema.catalogItems.isActive, true)));
  if (items.length !== 4) throw new AppError('BAD_CATALOG', 400, 'one or more catalog items not found/active');

  const [user] = await app.db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!user || user.isBanned) throw new AppError('FORBIDDEN', 403, 'banned');
  const priority = user.tier === 'PRO';

  const jobId = await app.db.transaction(async (tx) => {
    const [job] = await tx.insert(schema.jobs).values({
      userId, status: 'QUEUED', priority, creditsCharged: COST,
    }).returning();
    await atomicDeduct(tx as unknown as DB, userId, COST, job.id);
    await tx.insert(schema.jobInputs).values({
      jobId: job.id,
      upperGarmentKey: body.inputs.upperGarmentKey,
      modelCatalogId: body.inputs.modelCatalogId,
      poseCatalogId: body.inputs.poseCatalogId,
      backgroundCatalogId: body.inputs.backgroundCatalogId,
      lowerCatalogId: body.inputs.lowerCatalogId,
      userHint: promptGuard(body.userHint),
      params: body.params ?? null,
    });
    return job.id;
  });

  const stream = priority ? 'jobs:priority' : 'jobs:normal';
  try {
    await app.redis.xadd(stream, '*', 'jobId', jobId, 'userId', userId);
  } catch (e) {
    await refund(app.db, userId, COST, jobId, 'REFUND_ENQUEUE_FAIL');
    await app.db.update(schema.jobs).set({ status: 'FAILED', errorCode: 'ENQUEUE_FAIL' })
      .where(eq(schema.jobs.id, jobId));
    throw new AppError('ENQUEUE_FAIL', 503, 'queue unavailable');
  }
  return jobId;
}
