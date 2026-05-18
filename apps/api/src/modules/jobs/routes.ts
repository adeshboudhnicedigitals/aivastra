import type { FastifyInstance } from 'fastify';
import { CreateTryOnJobRequest } from '@aivastra/types';
import { schema } from '@aivastra/db';
import { eq, and, desc } from 'drizzle-orm';
import { z } from 'zod';
import { AppError } from '../../lib/errors';
import { createJob } from './create';
import { sseHandler } from './sse';
import { keys } from '@aivastra/storage';

export async function jobsRoutes(app: FastifyInstance) {
  app.post('/v1/jobs/tryon', { preHandler: app.requireUser,
    schema: { body: CreateTryOnJobRequest } }, async (req, reply) => {
    const jobId = await createJob(app, req.userId, req.body);
    reply.code(201);
    return { jobId };
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

  app.get('/v1/jobs/:id/events', {
    preHandler: app.requireUser,
    schema: { params: z.object({ id: z.string().uuid() }) },
  }, sseHandler);
}
