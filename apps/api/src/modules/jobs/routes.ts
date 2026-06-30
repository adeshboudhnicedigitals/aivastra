import { schema } from '@aivastra/db';
import { keys } from '@aivastra/storage';
import {
  CreateSareeJobRequest,
  CreateSimpleTryonRequest,
  CreateTryOnJobRequest,
  SareeConfigResponse,
} from '@aivastra/types';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { getSareeSettings } from '../saree/settings.js';
import { createJob, createSimpleTryonJob } from './create.js';
import { createSareeJob } from './createSaree.js';
import { sseHandler, userStreamHandler } from './sse.js';

// Caches 201 responses for 24h keyed on (userId, Idempotency-Key header).
// No-op when header is absent — backward compatible.
async function withIdempotency<T>(
  app: FastifyInstance,
  userId: string,
  idemKey: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  const redisKey = idemKey ? `idem:jobs:${userId}:${idemKey}` : null;
  if (redisKey) {
    const hit = await app.redis.get(redisKey);
    if (hit) return JSON.parse(hit) as T;
  }
  const result = await fn();
  if (redisKey) await app.redis.setex(redisKey, 86400, JSON.stringify(result));
  return result;
}

export async function jobsRoutes(app: FastifyInstance) {
  app.post(
    '/v1/jobs/tryon',
    { preHandler: app.requireUser, schema: { body: CreateTryOnJobRequest } },
    async (req, reply) => {
      const result = await withIdempotency(
        app,
        req.userId,
        req.headers['idempotency-key'] as string | undefined,
        () => createJob(app, req.userId, req.body as z.infer<typeof CreateTryOnJobRequest>),
      );
      reply.code(201);
      return result;
    },
  );

  app.post(
    '/v1/jobs/simple-tryon',
    { preHandler: app.requireUser, schema: { body: CreateSimpleTryonRequest } },
    async (req, reply) => {
      const result = await withIdempotency(
        app,
        req.userId,
        req.headers['idempotency-key'] as string | undefined,
        () =>
          createSimpleTryonJob(
            app,
            req.userId,
            req.body as z.infer<typeof CreateSimpleTryonRequest>,
          ),
      );
      reply.code(201);
      return result;
    },
  );

  // GET /v1/saree/config — exposed to the user page; tells the client whether the
  // admin has configured saree try-on (model image + active workflow).
  app.get(
    '/v1/saree/config',
    { preHandler: app.requireUser, schema: { response: { 200: SareeConfigResponse } } },
    async () => {
      const row = await getSareeSettings(app.db);
      const modelImageKey = row?.modelImageKey ?? null;
      const sampleSareeImageKey = row?.sampleSareeImageKey ?? null;
      const presign = async (key: string | null) => {
        if (!key) return null;
        try {
          const { url } = await app.storage.presignGet(key, 3600);
          return url;
        } catch {
          return null;
        }
      };
      const [modelImageUrl, sampleSareeImageUrl] = await Promise.all([
        presign(row?.modelImageThumbKey ?? modelImageKey),
        presign(row?.sampleSareeImageThumbKey ?? sampleSareeImageKey),
      ]);
      return {
        modelImageUrl,
        sampleSareeImageUrl,
        isConfigured: !!modelImageKey,
        creditsCost: 35 as const,
      };
    },
  );

  // POST /v1/jobs/saree
  app.post(
    '/v1/jobs/saree',
    { preHandler: app.requireUser, schema: { body: CreateSareeJobRequest } },
    async (req, reply) => {
      const result = await withIdempotency(
        app,
        req.userId,
        req.headers['idempotency-key'] as string | undefined,
        () => createSareeJob(app, req.userId, req.body as z.infer<typeof CreateSareeJobRequest>),
      );
      reply.code(201);
      return result;
    },
  );

  // GET /v1/tryon/categories — active categories + global person/garment sample URLs
  app.get('/v1/tryon/categories', { preHandler: app.requireUser }, async () => {
    const SETTINGS_ID = '00000000-0000-0000-0000-000000000001';
    const [cats, [settings]] = await Promise.all([
      app.db
        .select()
        .from(schema.tryonCategories)
        .where(eq(schema.tryonCategories.isActive, true))
        .orderBy(asc(schema.tryonCategories.sortOrder)),
      app.db.select().from(schema.tryonSettings).where(eq(schema.tryonSettings.id, SETTINGS_ID)),
    ]);

    const presign = async (key: string | null | undefined) => {
      if (!key) return null;
      try {
        return (await app.storage.presignGet(key, 3600)).url;
      } catch {
        return null;
      }
    };

    const [personSampleUrl, garmentSampleUrl] = await Promise.all([
      presign(settings?.personSampleThumbKey ?? settings?.personSampleKey),
      presign(settings?.garmentSampleThumbKey ?? settings?.garmentSampleKey),
    ]);

    return {
      categories: cats.map((c) => ({ id: c.id, name: c.name, slug: c.slug })),
      personSampleUrl,
      garmentSampleUrl,
    };
  });

  // List catalogues — grouped by catalogue_id, ordered newest first
  app.get('/v1/catalogues', { preHandler: app.requireUser }, async (req) => {
    const rows = await app.db
      .select({
        id: schema.jobs.id,
        catalogueId: schema.jobs.catalogueId,
        status: schema.jobs.status,
        createdAt: schema.jobs.createdAt,
        creditsCharged: schema.jobs.creditsCharged,
        genderSlug: schema.modelPoseAssets.genderSlug,
        params: schema.jobInputs.params,
      })
      .from(schema.jobs)
      .leftJoin(schema.jobInputs, eq(schema.jobInputs.jobId, schema.jobs.id))
      .leftJoin(schema.modelPoseAssets, eq(schema.modelPoseAssets.id, schema.jobInputs.poseId))
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
      // genderSlug + platform come from the first job that has one (all jobs in a catalogue share these)
      genderSlug: cJobs.find((j) => j.genderSlug)?.genderSlug ?? null,
      platform: ((cJobs[0]?.params as Record<string, unknown> | null)?.platform as string) ?? null,
      jobs: cJobs.map(({ genderSlug: _g, params: _p, ...j }) => j),
      createdAt: cJobs[cJobs.length - 1].createdAt,
    }));

    // Presign cover + cover thumbnail per catalogue server-side (fast local crypto, no network).
    // coverThumbUrl uses the 512px JPEG thumbnail; coverUrl is the full-size fallback.
    return Promise.all(
      groups.map(async (g) => {
        const cover = g.jobs.find((j) => j.status === 'COMPLETED');
        let coverUrl: string | null = null;
        let coverThumbUrl: string | null = null;
        if (cover) {
          try {
            const [output] = await app.db
              .select({ thumbnailKey: schema.jobOutputs.thumbnailKey })
              .from(schema.jobOutputs)
              .where(eq(schema.jobOutputs.jobId, cover.id));
            const thumbKey = output?.thumbnailKey;
            const [full, thumb] = await Promise.all([
              app.storage.presignGet(keys.output(cover.id), 3600),
              thumbKey ? app.storage.presignGet(thumbKey, 3600) : null,
            ]);
            coverUrl = full.url;
            coverThumbUrl = thumb?.url ?? null;
          } catch {
            /* missing object — leave null, client shows placeholder */
          }
        }
        return { ...g, coverUrl, coverThumbUrl };
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
      const { url, expiresIn } = await app.storage.presignGet(keys.output(id), 3600);
      return { url, expiresIn };
    },
  );

  app.get(
    '/v1/jobs/:id/thumbnail',
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

      const [output] = await app.db
        .select({ thumbnailKey: schema.jobOutputs.thumbnailKey })
        .from(schema.jobOutputs)
        .where(eq(schema.jobOutputs.jobId, id));

      // Fall back to full result if no thumbnail generated yet (e.g. backfill pending)
      const r2Key = output?.thumbnailKey ?? keys.output(id);
      const { url, expiresIn } = await app.storage.presignGet(r2Key, 3600);
      return { url, expiresIn };
    },
  );

  // Cancel a QUEUED job — refunds credits atomically, publishes SSE
  app.post(
    '/v1/jobs/:id/cancel',
    {
      preHandler: app.requireUser,
      schema: { params: z.object({ id: z.string().uuid() }) },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };

      let creditsCharged = 0;
      await app.db.transaction(async (tx) => {
        // Conditional UPDATE — only succeeds if the job is still QUEUED.
        // If the dispatcher has already moved it to PREPROCESSING this returns 0 rows → 409.
        const cancelled = await tx
          .update(schema.jobs)
          .set({ status: 'CANCELLED', completedAt: new Date() } as Parameters<
            ReturnType<typeof tx.update>['set']
          >[0])
          .where(
            and(
              eq(schema.jobs.id, id),
              eq(schema.jobs.userId, req.userId),
              eq(schema.jobs.status, 'QUEUED'),
            ),
          )
          .returning({ creditsCharged: schema.jobs.creditsCharged });

        if (!cancelled.length) {
          // Job not found, not owned by this user, or no longer QUEUED
          const [job] = await tx
            .select({ status: schema.jobs.status })
            .from(schema.jobs)
            .where(and(eq(schema.jobs.id, id), eq(schema.jobs.userId, req.userId)));
          if (!job) throw new AppError('NOT_FOUND', 404, 'job not found');
          throw new AppError('CONFLICT', 409, 'only queued jobs can be cancelled');
        }

        creditsCharged = cancelled[0]?.creditsCharged;

        await tx.insert(schema.jobEvents).values({
          jobId: id,
          eventType: 'CANCELLED',
          payload: {} as Record<string, unknown>,
        });

        // Refund credits — unique index on (job_id, reason) makes this safe against replays
        if (creditsCharged > 0) {
          const inserted = await tx
            .insert(schema.creditLedger)
            .values({
              userId: req.userId,
              delta: creditsCharged,
              reason: 'JOB_CANCEL_REFUND',
              jobId: id,
            })
            .onConflictDoNothing()
            .returning({ id: schema.creditLedger.id });
          if (inserted.length) {
            await tx
              .update(schema.userCredits)
              .set({ balance: sql`${schema.userCredits.balance} + ${creditsCharged}` })
              .where(eq(schema.userCredits.userId, req.userId));
          }
        }
      });

      // Publish SSE so open tabs update immediately
      const ssePayload = JSON.stringify({
        jobId: id,
        userId: req.userId,
        type: 'STATUS',
        status: 'CANCELLED',
      });
      await Promise.all([
        app.redis.publish(`sse:events:${req.userId}`, ssePayload),
        app.redis.publish('sse:events:admin', ssePayload),
      ]);

      reply.code(200).send({ ok: true, creditsRefunded: creditsCharged });
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

  // Contact form — auth required (tryon page is inside protected app shell)
  app.post(
    '/v1/contact',
    {
      preHandler: app.requireUser,
      schema: {
        body: z.object({
          name: z.string().min(1).max(200),
          email: z.string().email().max(200),
          phone: z.string().min(1).max(50),
          source: z.string().max(200).optional(),
          message: z.string().max(2000).optional(),
        }),
      },
    },
    async (req, reply) => {
      const body = req.body as {
        name: string;
        email: string;
        phone: string;
        source?: string;
        message?: string;
      };
      await app.db.insert(schema.contactRequests).values({
        userId: req.userId,
        name: body.name,
        email: body.email,
        phone: body.phone,
        source: body.source ?? null,
        message: body.message ?? null,
      });
      reply.code(204).send();
    },
  );

  // User-level stream: all job events for the authenticated user (single connection replaces per-job SSE)
  app.get('/v1/jobs/stream', { preHandler: app.requireUser }, userStreamHandler);

  // Per-job SSE kept for backward compatibility
  app.get(
    '/v1/jobs/:id/events',
    {
      preHandler: app.requireUser,
      schema: { params: z.object({ id: z.string().uuid() }) },
    },
    sseHandler,
  );
}
