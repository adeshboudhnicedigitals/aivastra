import { schema } from '@aivastra/db';
import { and, count, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { requireAdmin } from './guard.js';

/**
 * Bulk-flat catalogue jobs are parked at status HELD at upload time (credits
 * already deducted) and only enter the Redis stream when an admin decides GPU
 * capacity is free. Release is deliberately global: one button drains every
 * merchant's backlog at once, rather than per-merchant scheduling.
 */
export async function adminHeldJobsRoutes(app: FastifyInstance) {
  app.get('/admin/held-jobs', { preHandler: requireAdmin(['SUPER_ADMIN', 'ADMIN']) }, async () => {
    const rows = await app.db
      .select({
        userId: schema.jobs.userId,
        email: schema.users.email,
        count: count(),
        oldestCreatedAt: sql<string>`min(${schema.jobs.createdAt})`,
      })
      .from(schema.jobs)
      .leftJoin(schema.users, eq(schema.users.id, schema.jobs.userId))
      .where(eq(schema.jobs.status, 'HELD'))
      .groupBy(schema.jobs.userId, schema.users.email);

    return {
      total: rows.reduce((sum, row) => sum + row.count, 0),
      byUser: rows,
    };
  });

  app.post(
    '/admin/held-jobs/release',
    { preHandler: requireAdmin(['SUPER_ADMIN', 'ADMIN']) },
    async (req) => {
      const held = await app.db
        .select({ id: schema.jobs.id, userId: schema.jobs.userId })
        .from(schema.jobs)
        .where(eq(schema.jobs.status, 'HELD'));

      const now = new Date();
      let released = 0;
      for (const job of held) {
        // Status-guarded so two admins releasing at the same moment cannot
        // enqueue the same job twice — the loser's UPDATE matches no rows.
        const [claimed] = await app.db
          .update(schema.jobs)
          .set({ status: 'QUEUED', queuedAt: now })
          .where(and(eq(schema.jobs.id, job.id), eq(schema.jobs.status, 'HELD')))
          .returning({ id: schema.jobs.id });
        if (!claimed) continue;

        await app.redis.xadd(
          'jobs:low',
          'MAXLEN',
          '~',
          10000,
          '*',
          'jobId',
          job.id,
          'userId',
          job.userId ?? '',
        );
        released++;
      }

      req.log.info({ released }, 'released held bulk-flat jobs');
      return { released };
    },
  );
}
