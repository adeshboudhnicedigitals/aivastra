import type { FastifyInstance } from 'fastify';
import { schema } from '@aivastra/db';
import { eq, desc } from 'drizzle-orm';
import { z } from 'zod';
import { Paginated } from '@aivastra/types';
import { requireAdmin } from './guard';
import { refund } from '../credits/ledger';
import { AppError } from '../../lib/errors';

export async function adminJobsRoutes(app: FastifyInstance) {
  const R = requireAdmin(['SUPER_ADMIN', 'MODERATOR', 'SUPPORT']);
  const W = requireAdmin(['SUPER_ADMIN', 'MODERATOR']);

  app.get('/admin/jobs', { preHandler: R, schema: { querystring: Paginated } }, async (req) => {
    const { page, pageSize } = req.query as any;
    return app.db.select().from(schema.jobs).orderBy(desc(schema.jobs.createdAt))
      .limit(pageSize).offset((page - 1) * pageSize);
  });
  app.get('/admin/jobs/:id', { preHandler: R, schema: { params: z.object({ id: z.string().uuid() }) } },
    async (req) => {
      const { id } = req.params as any;
      const [job] = await app.db.select().from(schema.jobs).where(eq(schema.jobs.id, id));
      const [inputs] = await app.db.select().from(schema.jobInputs).where(eq(schema.jobInputs.jobId, id));
      const events = await app.db.select().from(schema.jobEvents)
        .where(eq(schema.jobEvents.jobId, id)).orderBy(desc(schema.jobEvents.createdAt)).limit(50);
      return { job, inputs, events };
    });

  app.post('/admin/jobs/:id/retry', { preHandler: W, schema: { params: z.object({ id: z.string().uuid() }) } },
    async (req) => {
      const { id } = req.params as any;
      const [job] = await app.db.select().from(schema.jobs).where(eq(schema.jobs.id, id));
      if (!job) throw new AppError('NOT_FOUND', 404, 'no job');
      if (job.status !== 'FAILED') throw new AppError('BAD_STATE', 409, 'only FAILED can retry');
      await app.db.update(schema.jobs).set({ status: 'QUEUED', errorCode: null, attempts: 0 })
        .where(eq(schema.jobs.id, id));
      const stream = job.priority ? 'jobs:priority' : 'jobs:normal';
      await app.redis.xadd(stream, '*', 'jobId', id, 'userId', job.userId);
      return { ok: true };
    });

  app.post('/admin/jobs/:id/cancel', { preHandler: W, schema: { params: z.object({ id: z.string().uuid() }) } },
    async (req) => {
      const { id } = req.params as any;
      const [job] = await app.db.select().from(schema.jobs).where(eq(schema.jobs.id, id));
      if (!job) throw new AppError('NOT_FOUND', 404, 'no job');
      if (['COMPLETED', 'CANCELLED'].includes(job.status)) return { ok: true };
      await app.db.update(schema.jobs).set({ status: 'CANCELLED', errorCode: 'ADMIN_CANCEL' })
        .where(eq(schema.jobs.id, id));
      await refund(app.db, job.userId, job.creditsCharged, id, 'REFUND_ADMIN_CANCEL');
      return { ok: true };
    });
}
