import { schema } from '@aivastra/db';
import { aliasedTable, and, count, desc, eq, ilike, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { refund } from '../credits/ledger.js';
import { adminStreamHandler } from '../jobs/sse.js';
import { requireAdmin } from './guard.js';

const JobsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: z
    .enum([
      'QUEUED',
      'PREPROCESSING',
      'GENERATING',
      'UPLOADING',
      'COMPLETED',
      'FAILED',
      'CANCELLED',
    ])
    .optional(),
  search: z.string().optional(),
});

export async function adminJobsRoutes(app: FastifyInstance) {
  const R = requireAdmin(['SUPER_ADMIN', 'MODERATOR', 'SUPPORT', 'ADMIN']);
  const W = requireAdmin(['SUPER_ADMIN', 'MODERATOR', 'ADMIN']);

  app.get('/admin/jobs', { preHandler: R, schema: { querystring: JobsQuery } }, async (req) => {
    // biome-ignore lint/suspicious/noExplicitAny: Fastify typed-provider workaround
    const { page, pageSize, status, search } = req.query as any;

    const conditions: ReturnType<typeof eq>[] = [];
    if (status) conditions.push(eq(schema.jobs.status, status));
    if (search) {
      conditions.push(
        or(
          ilike(schema.jobs.id, `%${search}%`),
          ilike(schema.users.email, `%${search}%`),
        ) as ReturnType<typeof eq>,
      );
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [{ total }] = await app.db
      .select({ total: count() })
      .from(schema.jobs)
      .leftJoin(schema.users, eq(schema.users.id, schema.jobs.userId))
      .where(where);

    const rows = await app.db
      .select({
        id: schema.jobs.id,
        status: schema.jobs.status,
        userId: schema.jobs.userId,
        userEmail: schema.users.email,
        workerId: schema.jobs.workerId,
        priority: schema.jobs.priority,
        creditsCharged: schema.jobs.creditsCharged,
        attempts: schema.jobs.attempts,
        errorCode: schema.jobs.errorCode,
        createdAt: schema.jobs.createdAt,
        startedAt: schema.jobs.startedAt,
        completedAt: schema.jobs.completedAt,
        faceLabel: schema.modelFaces.label,
        backgroundLabel: schema.modelBackgrounds.label,
        poseLabel: schema.modelPoses.label,
        hasLower: sql<boolean>`(${schema.jobInputs.lowerCatalogId} IS NOT NULL)`,
        hasShoe: sql<boolean>`(${schema.jobInputs.shoeCatalogId} IS NOT NULL)`,
        outputKey: schema.jobOutputs.resultKey,
      })
      .from(schema.jobs)
      .leftJoin(schema.users, eq(schema.users.id, schema.jobs.userId))
      .leftJoin(schema.jobInputs, eq(schema.jobInputs.jobId, schema.jobs.id))
      .leftJoin(schema.modelFaces, eq(schema.modelFaces.id, schema.jobInputs.faceId))
      .leftJoin(
        schema.modelBackgrounds,
        eq(schema.modelBackgrounds.id, schema.jobInputs.backgroundId),
      )
      .leftJoin(schema.modelPoses, eq(schema.modelPoses.id, schema.jobInputs.poseId))
      .leftJoin(schema.jobOutputs, eq(schema.jobOutputs.jobId, schema.jobs.id))
      .where(where)
      .orderBy(desc(schema.jobs.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    return {
      page,
      pageSize,
      total,
      items: rows.map((r) => ({
        ...r,
        outputUrl: r.outputKey ? app.storage.publicUrl(r.outputKey) : undefined,
        outputKey: undefined,
      })),
    };
  });

  app.get(
    '/admin/jobs/:id',
    { preHandler: R, schema: { params: z.object({ id: z.string().uuid() }) } },
    async (req) => {
      // biome-ignore lint/suspicious/noExplicitAny: Fastify typed-provider workaround
      const { id } = req.params as any;
      const lowerCatalog = aliasedTable(schema.catalogItems, 'lower_catalog');
      const shoeCatalog = aliasedTable(schema.catalogItems, 'shoe_catalog');

      const [row] = await app.db
        .select({
          id: schema.jobs.id,
          status: schema.jobs.status,
          userId: schema.jobs.userId,
          userEmail: schema.users.email,
          workerId: schema.jobs.workerId,
          priority: schema.jobs.priority,
          creditsCharged: schema.jobs.creditsCharged,
          attempts: schema.jobs.attempts,
          errorCode: schema.jobs.errorCode,
          createdAt: schema.jobs.createdAt,
          startedAt: schema.jobs.startedAt,
          completedAt: schema.jobs.completedAt,
          faceLabel: schema.modelFaces.label,
          backgroundLabel: schema.modelBackgrounds.label,
          poseLabel: schema.modelPoses.label,
          hasLower: sql<boolean>`(${schema.jobInputs.lowerCatalogId} IS NOT NULL)`,
          hasShoe: sql<boolean>`(${schema.jobInputs.shoeCatalogId} IS NOT NULL)`,
          userHint: schema.jobInputs.userHint,
          outputKey: schema.jobOutputs.resultKey,
          // ComfyUI-actual inputs — mirrors dispatcher's key resolution exactly
          faceSideKey: schema.modelPoses.faceSideR2Key,
          bgComfyKey: schema.modelPoses.bgComfyR2Key,
          bgFallbackKey: schema.modelBackgrounds.r2Key,
          poseKey: schema.modelPoses.r2Key,
          upperGarmentKey: schema.jobInputs.upperGarmentKey,
          lowerGarmentKey: schema.jobInputs.lowerGarmentKey,
          lowerCatalogKey: lowerCatalog.r2Key,
          shoeCatalogKey: shoeCatalog.r2Key,
          jobParams: schema.jobInputs.params,
        })
        .from(schema.jobs)
        .leftJoin(schema.users, eq(schema.users.id, schema.jobs.userId))
        .leftJoin(schema.jobInputs, eq(schema.jobInputs.jobId, schema.jobs.id))
        .leftJoin(schema.modelFaces, eq(schema.modelFaces.id, schema.jobInputs.faceId))
        .leftJoin(
          schema.modelBackgrounds,
          eq(schema.modelBackgrounds.id, schema.jobInputs.backgroundId),
        )
        .leftJoin(schema.modelPoses, eq(schema.modelPoses.id, schema.jobInputs.poseId))
        .leftJoin(schema.jobOutputs, eq(schema.jobOutputs.jobId, schema.jobs.id))
        .leftJoin(lowerCatalog, eq(lowerCatalog.id, schema.jobInputs.lowerCatalogId))
        .leftJoin(shoeCatalog, eq(shoeCatalog.id, schema.jobInputs.shoeCatalogId))
        .where(eq(schema.jobs.id, id));

      if (!row) throw new AppError('NOT_FOUND', 404, 'job not found');

      const events = await app.db
        .select()
        .from(schema.jobEvents)
        .where(eq(schema.jobEvents.jobId, id))
        .orderBy(desc(schema.jobEvents.createdAt))
        .limit(50);

      const pu = (key: string | null | undefined) => (key ? app.storage.publicUrl(key) : undefined);

      // Mirrors dispatcher resolution: lowerGarmentKey (user-upload) takes priority over catalog
      const lowerKey = row.lowerGarmentKey ?? row.lowerCatalogKey;
      const shoeKey = row.shoeCatalogKey;

      // Mirror dispatcher's bg key logic exactly:
      // Amazon always uses the white BG (bgFallbackKey = modelBackgrounds.r2Key, already overridden to white BG at job creation)
      // Non-Amazon uses pose's ComfyUI-specific bg key, falling back to display bg
      const params = (row.jobParams ?? {}) as Record<string, unknown>;
      const isAmazon = params.platform === 'Amazon';
      const bgKey = isAmazon ? row.bgFallbackKey : (row.bgComfyKey ?? row.bgFallbackKey);

      return {
        ...row,
        outputUrl: pu(row.outputKey),
        outputKey: undefined,
        faceSideKey: undefined,
        bgComfyKey: undefined,
        bgFallbackKey: undefined,
        poseKey: undefined,
        upperGarmentKey: undefined,
        lowerGarmentKey: undefined,
        lowerCatalogKey: undefined,
        shoeCatalogKey: undefined,
        jobParams: undefined,
        inputImages: {
          face: pu(row.faceSideKey),
          background: pu(bgKey),
          pose: pu(row.poseKey),
          upper: pu(row.upperGarmentKey),
          lower: pu(lowerKey),
          shoe: pu(shoeKey),
        },
        events,
      };
    },
  );

  app.post(
    '/admin/jobs/:id/retry',
    { preHandler: W, schema: { params: z.object({ id: z.string().uuid() }) } },
    async (req) => {
      // biome-ignore lint/suspicious/noExplicitAny: Fastify typed-provider workaround
      const { id } = req.params as any;
      const [job] = await app.db.select().from(schema.jobs).where(eq(schema.jobs.id, id));
      if (!job) throw new AppError('NOT_FOUND', 404, 'no job');
      if (job.status !== 'FAILED') throw new AppError('BAD_STATE', 409, 'only FAILED can retry');
      await app.db
        .update(schema.jobs)
        .set({ status: 'QUEUED', errorCode: null, attempts: 0 })
        .where(eq(schema.jobs.id, id));
      const stream = job.priority ? 'jobs:priority' : 'jobs:normal';
      await app.redis.xadd(stream, '*', 'jobId', id, 'userId', job.userId);
      return { ok: true };
    },
  );

  app.post(
    '/admin/jobs/:id/cancel',
    { preHandler: W, schema: { params: z.object({ id: z.string().uuid() }) } },
    async (req) => {
      // biome-ignore lint/suspicious/noExplicitAny: Fastify typed-provider workaround
      const { id } = req.params as any;
      const [job] = await app.db.select().from(schema.jobs).where(eq(schema.jobs.id, id));
      if (!job) throw new AppError('NOT_FOUND', 404, 'no job');
      if (['COMPLETED', 'CANCELLED'].includes(job.status)) return { ok: true };
      await app.db
        .update(schema.jobs)
        .set({ status: 'CANCELLED', errorCode: 'ADMIN_CANCEL' })
        .where(eq(schema.jobs.id, id));
      await refund(app.db, job.userId, job.creditsCharged, id, 'REFUND_ADMIN_CANCEL');
      return { ok: true };
    },
  );

  // Admin real-time job event stream — delivers all job transitions across all users
  app.get('/admin/jobs/stream', { preHandler: R }, adminStreamHandler);
}
