import { schema } from '@aivastra/db';
import { desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { requireAdmin } from './guard.js';

export async function adminContactRoutes(app: FastifyInstance) {
  const R = requireAdmin(['SUPER_ADMIN', 'MODERATOR', 'ADMIN', 'SUPPORT']);
  const W = requireAdmin(['SUPER_ADMIN', 'MODERATOR', 'ADMIN']);

  // GET /admin/contact-requests?status=new|read|done|all&limit=50&offset=0
  app.get('/admin/contact-requests', { preHandler: R }, async (req) => {
    const { status = 'all', limit = '50', offset = '0' } = req.query as Record<string, string>;
    const lim = Math.min(Number(limit) || 50, 200);
    const off = Number(offset) || 0;

    const where = status !== 'all' ? eq(schema.contactRequests.status, status) : undefined;

    const [rows, [countRow]] = await Promise.all([
      app.db
        .select()
        .from(schema.contactRequests)
        .where(where)
        .orderBy(desc(schema.contactRequests.createdAt))
        .limit(lim)
        .offset(off),
      app.db
        .select({ total: sql<number>`count(*)::int` })
        .from(schema.contactRequests)
        .where(where),
    ]);

    return { rows, total: countRow?.total ?? 0 };
  });

  // GET /admin/contact-requests/unread-count — for badge
  app.get('/admin/contact-requests/unread-count', { preHandler: R }, async () => {
    const [row] = await app.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.contactRequests)
      .where(eq(schema.contactRequests.status, 'new'));
    return { count: row?.count ?? 0 };
  });

  // PATCH /admin/contact-requests/:id — update status
  app.patch(
    '/admin/contact-requests/:id',
    {
      preHandler: W,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({ status: z.enum(['new', 'read', 'done']) }),
      },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const { status } = req.body as { status: string };
      const [row] = await app.db
        .update(schema.contactRequests)
        .set({ status })
        .where(eq(schema.contactRequests.id, id))
        .returning();
      if (!row) throw new AppError('NOT_FOUND', 404, 'contact request not found');
      return row;
    },
  );
}
