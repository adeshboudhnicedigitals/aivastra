import { schema } from '@aivastra/db';
import { keys } from '@aivastra/storage';
import { CreateTryOnJobRequest } from '@aivastra/types';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { createJob } from './create.js';
import { sseHandler } from './sse.js';

export async function jobsRoutes(app: FastifyInstance) {
  app.post(
    '/v1/jobs/tryon',
    { preHandler: app.requireUser, schema: { body: CreateTryOnJobRequest } },
    async (req, reply) => {
      const result = await createJob(
        app,
        req.userId,
        req.body as z.infer<typeof CreateTryOnJobRequest>,
      );
      reply.code(201);
      return result;
    },
  );

  // List catalogues — grouped by catalogue_id, ordered newest first
  app.get('/v1/catalogues', { preHandler: app.requireUser }, async (req) => {
    const rows = await app.db
      .select({
        id: schema.jobs.id,
        catalogueId: schema.jobs.catalogueId,
        status: schema.jobs.status,
        createdAt: schema.jobs.createdAt,
        creditsCharged: schema.jobs.creditsCharged,
        genderSlug: schema.garmentSubcategories.genderSlug,
      })
      .from(schema.jobs)
      .leftJoin(schema.jobInputs, eq(schema.jobInputs.jobId, schema.jobs.id))
      .leftJoin(schema.modelPoses, eq(schema.modelPoses.id, schema.jobInputs.poseId))
      .leftJoin(
        schema.garmentSubcategories,
        eq(schema.garmentSubcategories.id, schema.modelPoses.subcategoryId),
      )
      .where(eq(schema.jobs.userId, req.userId))
      .orderBy(desc(schema.jobs.createdAt))
      .limit(200);

    // Group by catalogueId; jobs without catalogueId use their own id
    type Row = (typeof rows)[number];
    const map = new Map<string, Row[]>();
    for (const row of rows) {
      const key = row.catalogueId ?? row.id;
      if (!map.has(key)) map.set(key, []);
      map.get(key)?.push(row);
    }

    const groups = Array.from(map.entries()).map(([catalogueId, cJobs]) => ({
      catalogueId,
      // genderSlug comes from the first job that has one (all jobs in a catalogue share the same gender)
      genderSlug: cJobs.find((j) => j.genderSlug)?.genderSlug ?? null,
      jobs: cJobs.map(({ genderSlug: _g, ...j }) => j),
      createdAt: cJobs[cJobs.length - 1].createdAt,
    }));

    // Presign a cover URL per catalogue server-side (fast local crypto, no network)
    // so the client renders covers from one response instead of one request per card.
    return Promise.all(
      groups.map(async (g) => {
        const cover = g.jobs.find((j) => j.status === 'COMPLETED');
        let coverUrl: string | null = null;
        if (cover) {
          try {
            const { url } = await app.storage.presignGet(keys.output(cover.id), 3600);
            coverUrl = url;
          } catch {
            /* missing object — leave null, client shows placeholder */
          }
        }
        return { ...g, coverUrl };
      }),
    );
  });

  // Single catalogue — all jobs for a catalogueId
  app.get(
    '/v1/catalogues/:id',
    {
      preHandler: app.requireUser,
      schema: { params: z.object({ id: z.string().uuid() }) },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const jobs = await app.db
        .select()
        .from(schema.jobs)
        .where(and(eq(schema.jobs.catalogueId, id), eq(schema.jobs.userId, req.userId)))
        .orderBy(schema.jobs.createdAt);
      if (jobs.length === 0) throw new AppError('NOT_FOUND', 404, 'catalogue not found');

      // All jobs in a catalogue share the same aspectRatio and garment (set once at creation).
      // Pull both from any one job's inputs.
      const [anyInput] = await app.db
        .select({
          params: schema.jobInputs.params,
          upperGarmentKey: schema.jobInputs.upperGarmentKey,
        })
        .from(schema.jobInputs)
        .innerJoin(schema.jobs, eq(schema.jobInputs.jobId, schema.jobs.id))
        .where(and(eq(schema.jobs.catalogueId, id), eq(schema.jobs.userId, req.userId)))
        .limit(1);
      const aspectRatio =
        (anyInput?.params as { aspectRatio?: string } | null)?.aspectRatio ?? null;

      let garmentUrl: string | null = null;
      if (anyInput?.upperGarmentKey) {
        try {
          const { url } = await app.storage.presignGet(anyInput.upperGarmentKey, 3600);
          garmentUrl = url;
        } catch {
          // non-fatal
        }
      }

      return { catalogueId: id, jobs, aspectRatio, garmentUrl };
    },
  );

  // List user's unique uploaded garments — deduplicated by R2 key
  app.get('/v1/assets', { preHandler: app.requireUser }, async (req) => {
    const result = await app.db
      .select({
        r2Key: schema.jobInputs.upperGarmentKey,
        uploadedAt: sql<Date>`MAX(${schema.jobs.createdAt})`.as('uploadedAt'),
        jobCount: sql<number>`COUNT(${schema.jobs.id})`.as('jobCount'),
      })
      .from(schema.jobInputs)
      .innerJoin(schema.jobs, eq(schema.jobInputs.jobId, schema.jobs.id))
      .where(eq(schema.jobs.userId, req.userId))
      .groupBy(schema.jobInputs.upperGarmentKey)
      .orderBy(desc(sql`MAX(${schema.jobs.createdAt})`));

    // Presign each thumbnail server-side so the client gets URLs in one response
    // instead of firing a /v1/uploads/thumbnail request per asset (N+1).
    return Promise.all(
      result.map(async (asset) => {
        let thumbnailUrl: string | null = null;
        if (asset.r2Key) {
          try {
            const { url } = await app.storage.presignGet(asset.r2Key, 3600);
            thumbnailUrl = url;
          } catch {
            /* missing object — leave null, client shows placeholder */
          }
        }
        return {
          r2Key: asset.r2Key,
          uploadedAt: asset.uploadedAt,
          jobsCount: asset.jobCount,
          thumbnailUrl,
        };
      }),
    );
  });

  app.get('/v1/jobs', { preHandler: app.requireUser }, async (req) => {
    return app.db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.userId, req.userId))
      .orderBy(desc(schema.jobs.createdAt))
      .limit(50);
  });

  app.get(
    '/v1/jobs/:id',
    {
      preHandler: app.requireUser,
      schema: { params: z.object({ id: z.string().uuid() }) },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const [job] = await app.db
        .select()
        .from(schema.jobs)
        .where(and(eq(schema.jobs.id, id), eq(schema.jobs.userId, req.userId)));
      if (!job) throw new AppError('NOT_FOUND', 404, 'job not found');
      return job;
    },
  );

  app.get(
    '/v1/jobs/:id/result',
    {
      preHandler: app.requireUser,
      schema: { params: z.object({ id: z.string().uuid() }) },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const [job] = await app.db
        .select()
        .from(schema.jobs)
        .where(and(eq(schema.jobs.id, id), eq(schema.jobs.userId, req.userId)));
      if (!job) throw new AppError('NOT_FOUND', 404, 'job not found');
      if (job.status !== 'COMPLETED') throw new AppError('NOT_READY', 409, 'job not complete');
      const { url, expiresIn } = await app.storage.presignGet(keys.output(id), 300);
      return { url, expiresIn };
    },
  );

  // Delete a terminal job (COMPLETED / FAILED / CANCELLED) — also removes R2 output
  app.delete(
    '/v1/jobs/:id',
    {
      preHandler: app.requireUser,
      schema: { params: z.object({ id: z.string().uuid() }) },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const [job] = await app.db
        .select()
        .from(schema.jobs)
        .where(and(eq(schema.jobs.id, id), eq(schema.jobs.userId, req.userId)));
      if (!job) throw new AppError('NOT_FOUND', 404, 'job not found');
      const TERMINAL = ['COMPLETED', 'FAILED', 'CANCELLED'];
      if (!TERMINAL.includes(job.status)) {
        throw new AppError('CONFLICT', 409, 'cannot delete an active job');
      }
      // Delete R2 output object if it exists
      if (job.status === 'COMPLETED') {
        try {
          await app.storage.deleteObject(keys.output(id));
        } catch {
          /* ignore if missing */
        }
      }
      // Delete child rows explicitly before the parent to avoid FK ordering issues
      await app.db.delete(schema.jobInputs).where(eq(schema.jobInputs.jobId, id));
      await app.db.delete(schema.jobEvents).where(eq(schema.jobEvents.jobId, id));
      await app.db.delete(schema.jobOutputs).where(eq(schema.jobOutputs.jobId, id));
      await app.db.delete(schema.jobs).where(eq(schema.jobs.id, id));
      reply.code(204).send();
    },
  );

  app.get(
    '/v1/jobs/:id/events',
    {
      preHandler: app.requireUser,
      schema: { params: z.object({ id: z.string().uuid() }) },
    },
    sseHandler,
  );
}
