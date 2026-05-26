import type { FastifyInstance } from 'fastify';
import { CreateTryOnJobRequest } from '@aivastra/types';
import { schema } from '@aivastra/db';
import { eq, and, desc } from 'drizzle-orm';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { createJob } from './create.js';
import { sseHandler } from './sse.js';
import { keys } from '@aivastra/storage';

export async function jobsRoutes(app: FastifyInstance) {
  app.post('/v1/jobs/tryon', { preHandler: app.requireUser,
    schema: { body: CreateTryOnJobRequest } }, async (req, reply) => {
    const result = await createJob(app, req.userId, req.body);
    reply.code(201);
    return result;
  });

  // List catalogues — grouped by catalogue_id, ordered newest first
  app.get('/v1/catalogues', { preHandler: app.requireUser }, async (req) => {
    const jobs = await app.db.select({
      id: schema.jobs.id,
      catalogueId: schema.jobs.catalogueId,
      status: schema.jobs.status,
      createdAt: schema.jobs.createdAt,
      creditsCharged: schema.jobs.creditsCharged,
    }).from(schema.jobs)
      .where(eq(schema.jobs.userId, req.userId))
      .orderBy(desc(schema.jobs.createdAt))
      .limit(200);

    // Group by catalogueId; jobs without catalogueId use their own id
    const map = new Map<string, typeof jobs>();
    for (const job of jobs) {
      const key = job.catalogueId ?? job.id;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(job);
    }

    return Array.from(map.entries()).map(([catalogueId, cJobs]) => ({
      catalogueId,
      jobs: cJobs,
      createdAt: cJobs[cJobs.length - 1].createdAt,
    }));
  });

  // Single catalogue — all jobs for a catalogueId
  app.get('/v1/catalogues/:id', {
    preHandler: app.requireUser,
    schema: { params: z.object({ id: z.string().uuid() }) },
  }, async (req) => {
    const { id } = req.params as { id: string };
    const jobs = await app.db.select().from(schema.jobs)
      .where(and(
        eq(schema.jobs.catalogueId, id),
        eq(schema.jobs.userId, req.userId),
      ))
      .orderBy(schema.jobs.createdAt);
    if (jobs.length === 0) throw new AppError('NOT_FOUND', 404, 'catalogue not found');
    return { catalogueId: id, jobs };
  });

  app.get('/v1/jobs', { preHandler: app.requireUser }, async (req) => {
    return app.db.select().from(schema.jobs)
      .where(eq(schema.jobs.userId, req.userId))
      .orderBy(desc(schema.jobs.createdAt)).limit(50);
  });

  app.get('/v1/jobs/:id', {
    preHandler: app.requireUser,
    schema: { params: z.object({ id: z.string().uuid() }) },
  }, async (req) => {
    const { id } = req.params as { id: string };
    const [job] = await app.db.select().from(schema.jobs)
      .where(and(eq(schema.jobs.id, id), eq(schema.jobs.userId, req.userId)));
    if (!job) throw new AppError('NOT_FOUND', 404, 'job not found');
    return job;
  });

  app.get('/v1/jobs/:id/result', {
    preHandler: app.requireUser,
    schema: { params: z.object({ id: z.string().uuid() }) },
  }, async (req) => {
    const { id } = req.params as { id: string };
    const [job] = await app.db.select().from(schema.jobs)
      .where(and(eq(schema.jobs.id, id), eq(schema.jobs.userId, req.userId)));
    if (!job) throw new AppError('NOT_FOUND', 404, 'job not found');
    if (job.status !== 'COMPLETED') throw new AppError('NOT_READY', 409, 'job not complete');
    const { url, expiresIn } = await app.storage.presignGet(keys.output(id), 300);
    return { url, expiresIn };
  });

  // Delete a terminal job (COMPLETED / FAILED / CANCELLED) — also removes R2 output
  app.delete('/v1/jobs/:id', {
    preHandler: app.requireUser,
    schema: { params: z.object({ id: z.string().uuid() }) },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const [job] = await app.db.select().from(schema.jobs)
      .where(and(eq(schema.jobs.id, id), eq(schema.jobs.userId, req.userId)));
    if (!job) throw new AppError('NOT_FOUND', 404, 'job not found');
    const TERMINAL = ['COMPLETED', 'FAILED', 'CANCELLED'];
    if (!TERMINAL.includes(job.status)) {
      throw new AppError('CONFLICT', 409, 'cannot delete an active job');
    }
    // Delete R2 output object if it exists
    if (job.status === 'COMPLETED') {
      try { await app.storage.deleteObject(keys.output(id)); } catch { /* ignore if missing */ }
    }
    // Delete child rows explicitly before the parent to avoid FK ordering issues
    await app.db.delete(schema.jobInputs).where(eq(schema.jobInputs.jobId, id));
    await app.db.delete(schema.jobEvents).where(eq(schema.jobEvents.jobId, id));
    await app.db.delete(schema.jobOutputs).where(eq(schema.jobOutputs.jobId, id));
    await app.db.delete(schema.jobs).where(eq(schema.jobs.id, id));
    reply.code(204).send();
  });

  app.get('/v1/jobs/:id/events', {
    preHandler: app.requireUser,
    schema: { params: z.object({ id: z.string().uuid() }) },
  }, sseHandler);
}
