import { schema } from '@aivastra/db';
import { JOB_SOURCE, jobSourceSchema } from '@aivastra/types';
import { aliasedTable, and, count, desc, eq, gte, ilike, lte, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { refund } from '../credits/ledger.js';
import { adminStreamHandler } from '../jobs/sse.js';
import { requireAdmin } from './guard.js';
import { jobTypeSql } from './job-type.js';

const JobsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: z
    .enum([
      'HELD',
      'QUEUED',
      'PREPROCESSING',
      'GENERATING',
      'UPLOADING',
      'COMPLETED',
      'FAILED',
      'CANCELLED',
      'PENDING_MANNEQUIN',
    ])
    .optional(),
  search: z.string().optional(),
  date: z.string().optional(),
  jobType: jobSourceSchema.optional(),
  workerId: z.string().optional(),
  // Created-at range filter (datetime-local input values, e.g. "2026-08-18T14:30") —
  // separate from `date` above (exact-day match), which other admin pages already
  // navigate here with via router state and must keep working unchanged.
  createdFrom: z.string().optional(),
  createdTo: z.string().optional(),
});

export async function adminJobsRoutes(app: FastifyInstance) {
  const R = requireAdmin(['SUPER_ADMIN', 'MODERATOR', 'SUPPORT', 'ADMIN']);
  const W = requireAdmin(['SUPER_ADMIN', 'MODERATOR', 'ADMIN']);

  app.get('/admin/jobs/sources', { preHandler: R }, async () => Object.values(JOB_SOURCE));

  app.get('/admin/jobs', { preHandler: R, schema: { querystring: JobsQuery } }, async (req) => {
    const query =
      // biome-ignore lint/suspicious/noExplicitAny: Fastify typed-provider workaround
      req.query as any;
    const { page, pageSize, status, search, date, jobType, workerId, createdFrom, createdTo } =
      query;

    const conditions: ReturnType<typeof eq>[] = [];
    if (status) conditions.push(eq(schema.jobs.status, status));
    if (date) {
      // Postgres exact date match for UTC createdAt
      conditions.push(sql`${schema.jobs.createdAt}::date = ${date}::date` as ReturnType<typeof eq>);
    }
    if (jobType) {
      conditions.push(sql`${jobTypeSql()} = ${jobType}` as ReturnType<typeof eq>);
    }
    if (workerId) conditions.push(eq(schema.jobs.workerId, workerId));
    if (createdFrom) conditions.push(gte(schema.jobs.createdAt, new Date(createdFrom)));
    if (createdTo) conditions.push(lte(schema.jobs.createdAt, new Date(createdTo)));
    if (search) {
      conditions.push(
        or(
          ilike(sql`${schema.jobs.id}::text`, `%${search}%`),
          ilike(schema.users.email, `%${search}%`),
          ilike(schema.users.username, `%${search}%`),
        ) as ReturnType<typeof eq>,
      );
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    // jobType filtering (jobTypeSql) reads job_inputs.face_id, so the count query
    // needs the same join as the row query below or it 500s whenever jobType is set.
    const [{ total }] = await app.db
      .select({ total: count() })
      .from(schema.jobs)
      .leftJoin(schema.users, eq(schema.users.id, schema.jobs.userId))
      .leftJoin(schema.jobInputs, eq(schema.jobInputs.jobId, schema.jobs.id))
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
        faceThumbnailKey: schema.modelFaces.thumbnailKey,
        backgroundLabel: schema.modelBackgrounds.label,
        poseLabel: schema.modelPoseAssets.displayName,
        hasLower: sql<boolean>`(${schema.jobInputs.lowerCatalogId} IS NOT NULL)`,
        hasShoe: sql<boolean>`(${schema.jobInputs.shoeCatalogId} IS NOT NULL)`,
        outputKey: schema.jobOutputs.resultKey,
        jobType: jobTypeSql(),
      })
      .from(schema.jobs)
      .leftJoin(schema.users, eq(schema.users.id, schema.jobs.userId))
      .leftJoin(schema.jobInputs, eq(schema.jobInputs.jobId, schema.jobs.id))
      .leftJoin(schema.modelFaces, eq(schema.modelFaces.id, schema.jobInputs.faceId))
      .leftJoin(
        schema.modelBackgrounds,
        eq(schema.modelBackgrounds.id, schema.jobInputs.backgroundId),
      )
      .leftJoin(schema.modelPoseAssets, eq(schema.modelPoseAssets.id, schema.jobInputs.poseId))
      .leftJoin(schema.jobOutputs, eq(schema.jobOutputs.jobId, schema.jobs.id))
      .where(where)
      .orderBy(desc(schema.jobs.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    return {
      page,
      pageSize,
      total,
      items: await Promise.all(
        rows.map(async (r) => ({
          ...r,
          outputUrl: r.outputKey
            ? (await app.storage.presignGet(r.outputKey, 3600)).url
            : undefined,
          faceThumbnailUrl: r.faceThumbnailKey
            ? (await app.storage.presignGet(r.faceThumbnailKey, 3600)).url
            : undefined,
          outputKey: undefined,
          faceThumbnailKey: undefined,
        })),
      ),
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
      const defaultWorkflow = aliasedTable(schema.workflowTemplates, 'default_workflow');
      const overrideWorkflow = aliasedTable(schema.workflowTemplates, 'override_workflow');

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
          poseLabel: schema.modelPoseAssets.displayName,
          hasLower: sql<boolean>`(${schema.jobInputs.lowerCatalogId} IS NOT NULL)`,
          hasShoe: sql<boolean>`(${schema.jobInputs.shoeCatalogId} IS NOT NULL)`,
          jobType: jobTypeSql(),
          userHint: schema.jobInputs.userHint,
          outputKey: schema.jobOutputs.resultKey,
          customerPhotoKey: schema.jobs.customerPhotoKey,
          // ComfyUI-actual inputs — mirrors dispatcher's key resolution exactly
          // faceSideKey lives on model_faces, bgComfyKey lives on model_backgrounds
          faceSideKey: schema.modelFaces.faceSideR2Key,
          faceDisplayKey: schema.modelFaces.r2Key,
          bgComfyKey: schema.modelBackgrounds.bgComfyR2Key,
          bgFallbackKey: schema.modelBackgrounds.r2Key,
          poseKey: schema.modelPoseAssets.r2Key,
          upperGarmentKey: schema.jobInputs.upperGarmentKey,
          lowerGarmentKey: schema.jobInputs.lowerGarmentKey,
          lowerCatalogKey: lowerCatalog.r2Key,
          shoeCatalogKey: shoeCatalog.r2Key,
          jobParams: schema.jobInputs.params,
          defaultWorkflowLabel: defaultWorkflow.label,
          overrideWorkflowLabel: overrideWorkflow.label,
        })
        .from(schema.jobs)
        .leftJoin(schema.users, eq(schema.users.id, schema.jobs.userId))
        .leftJoin(schema.jobInputs, eq(schema.jobInputs.jobId, schema.jobs.id))
        .leftJoin(schema.modelFaces, eq(schema.modelFaces.id, schema.jobInputs.faceId))
        .leftJoin(
          schema.modelBackgrounds,
          eq(schema.modelBackgrounds.id, schema.jobInputs.backgroundId),
        )
        .leftJoin(schema.modelPoseAssets, eq(schema.modelPoseAssets.id, schema.jobInputs.poseId))
        .leftJoin(schema.jobOutputs, eq(schema.jobOutputs.jobId, schema.jobs.id))
        .leftJoin(lowerCatalog, eq(lowerCatalog.id, schema.jobInputs.lowerCatalogId))
        .leftJoin(shoeCatalog, eq(shoeCatalog.id, schema.jobInputs.shoeCatalogId))
        .leftJoin(
          defaultWorkflow,
          eq(defaultWorkflow.id, schema.modelPoseAssets.workflowTemplateId),
        )
        .leftJoin(
          schema.poseGarmentConfigs,
          and(
            eq(schema.poseGarmentConfigs.poseAssetId, schema.jobInputs.poseId),
            eq(schema.poseGarmentConfigs.subcategoryId, schema.jobInputs.garmentTypeId),
          ),
        )
        .leftJoin(
          overrideWorkflow,
          eq(overrideWorkflow.id, schema.poseGarmentConfigs.workflowTemplateId),
        )
        .where(eq(schema.jobs.id, id));

      if (!row) throw new AppError('NOT_FOUND', 404, 'job not found');

      const events = await app.db
        .select()
        .from(schema.jobEvents)
        .where(eq(schema.jobEvents.jobId, id))
        .orderBy(desc(schema.jobEvents.createdAt))
        .limit(50);

      const pu = async (key: string | null | undefined) =>
        key ? (await app.storage.presignGet(key, 3600)).url : undefined;

      // Mirrors dispatcher resolution: lowerGarmentKey (user-upload) takes priority over catalog
      const lowerKey = row.lowerGarmentKey ?? row.lowerCatalogKey;
      const shoeKey = row.shoeCatalogKey;

      // Mirror dispatcher's bg key logic exactly:
      // Amazon always uses the white BG (bgFallbackKey = modelBackgrounds.r2Key, already overridden to white BG at job creation)
      // Non-Amazon uses pose's ComfyUI-specific bg key, falling back to display bg
      const params = (row.jobParams ?? {}) as Record<string, unknown>;
      const isAmazon = params.platform === 'Amazon';
      const bgKey = isAmazon ? row.bgFallbackKey : (row.bgComfyKey ?? row.bgFallbackKey);

      // For tryon-direct jobs, person image is stored in params.personKey.
      // Merchant/Shopify tryon jobs instead store it on jobs.customerPhotoKey.
      const personKey =
        (typeof params.personKey === 'string' ? params.personKey : undefined) ??
        row.customerPhotoKey ??
        undefined;

      // For tryon-direct jobs the workflow comes from params.workflowTemplateId, not pose join
      let workflowLabel = row.overrideWorkflowLabel ?? row.defaultWorkflowLabel ?? null;
      if (!workflowLabel && typeof params.workflowTemplateId === 'string') {
        const [wt] = await app.db
          .select({ label: schema.workflowTemplates.label })
          .from(schema.workflowTemplates)
          .where(eq(schema.workflowTemplates.id, params.workflowTemplateId));
        workflowLabel = wt?.label ?? null;
      }

      return {
        ...row,
        outputUrl: await pu(row.outputKey),
        outputKey: undefined,
        faceSideKey: undefined,
        faceDisplayKey: undefined,
        bgComfyKey: undefined,
        bgFallbackKey: undefined,
        poseKey: undefined,
        upperGarmentKey: undefined,
        lowerGarmentKey: undefined,
        lowerCatalogKey: undefined,
        shoeCatalogKey: undefined,
        jobParams: undefined,
        customerPhotoKey: undefined,
        workflowLabel,
        defaultWorkflowLabel: undefined,
        overrideWorkflowLabel: undefined,
        inputImages: {
          person: await pu(personKey),
          face: await pu(row.faceSideKey ?? row.faceDisplayKey),
          background: await pu(bgKey),
          pose: await pu(row.poseKey),
          upper: await pu(row.upperGarmentKey),
          lower: await pu(lowerKey),
          shoe: await pu(shoeKey),
        },
        events,
      };
    },
  );

  app.post('/admin/jobs/flush-queue', { preHandler: W }, async () => {
    const queued = await app.db
      .select({
        id: schema.jobs.id,
        userId: schema.jobs.userId,
        creditsCharged: schema.jobs.creditsCharged,
      })
      .from(schema.jobs)
      .where(eq(schema.jobs.status, 'QUEUED'));

    if (queued.length === 0) return { flushed: 0 };

    await app.db
      .update(schema.jobs)
      .set({ status: 'CANCELLED', errorCode: 'ADMIN_FLUSH' })
      .where(eq(schema.jobs.status, 'QUEUED'));

    await Promise.all(
      queued
        .filter((j) => j.userId && j.creditsCharged > 0)
        .map((j) =>
          refund(app.db, j.userId as string, j.creditsCharged, j.id, 'REFUND_ADMIN_CANCEL'),
        ),
    );

    return { flushed: queued.length };
  });

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
      const stream = `jobs:${job.queueStream ?? (job.priority ? 'priority' : 'normal')}`;
      await app.redis.xadd(
        stream,
        'MAXLEN',
        '~',
        10000,
        '*',
        'jobId',
        id,
        'userId',
        job.userId ?? '',
      );
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
      if (job.userId) {
        await refund(app.db, job.userId, job.creditsCharged, id, 'REFUND_ADMIN_CANCEL');
      }
      return { ok: true };
    },
  );

  // Admin real-time job event stream — delivers all job transitions across all users
  app.get('/admin/jobs/stream', { preHandler: R }, adminStreamHandler);
}
