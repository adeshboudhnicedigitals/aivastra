import type { FastifyInstance } from 'fastify';
import { schema } from '@aivastra/db';
import { eq, sql, desc } from 'drizzle-orm';
import { z } from 'zod';
import { Paginated, UpdateUserBody } from '@aivastra/types';
import { requireAdmin } from './guard';

export async function adminUsersRoutes(app: FastifyInstance) {
  const ALL = requireAdmin(['SUPER_ADMIN', 'MODERATOR', 'SUPPORT']);
  const WRITE = requireAdmin(['SUPER_ADMIN', 'MODERATOR']);

  app.get('/admin/users', { preHandler: ALL, schema: { querystring: Paginated } }, async (req) => {
    const { page, pageSize } = req.query as any;
    const rows = await app.db.select().from(schema.users)
      .orderBy(desc(schema.users.createdAt)).limit(pageSize).offset((page - 1) * pageSize);
    return { page, pageSize, items: rows };
  });

  app.get('/admin/users/:id', {
    preHandler: ALL, schema: { params: z.object({ id: z.string().uuid() }) },
  }, async (req) => {
    const { id } = req.params as any;
    const [user] = await app.db.select().from(schema.users).where(eq(schema.users.id, id));
    const [credits] = await app.db.select().from(schema.userCredits).where(eq(schema.userCredits.userId, id));
    const jobs = await app.db.select().from(schema.jobs).where(eq(schema.jobs.userId, id))
      .orderBy(desc(schema.jobs.createdAt)).limit(20);
    return { user, balance: credits?.balance ?? 0, recentJobs: jobs };
  });

  app.patch('/admin/users/:id', {
    preHandler: WRITE,
    schema: { params: z.object({ id: z.string().uuid() }), body: UpdateUserBody },
  }, async (req) => {
    const { id } = req.params as any;
    const { tier, isBanned, banReason, forceLogout } = req.body as any;
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (tier !== undefined) patch.tier = tier;
    if (isBanned !== undefined) patch.isBanned = isBanned;
    if (banReason !== undefined) patch.banReason = banReason;
    await app.db.update(schema.users).set(patch).where(eq(schema.users.id, id));
    if (forceLogout) await app.db.update(schema.refreshTokens).set({ revoked: true })
      .where(eq(schema.refreshTokens.userId, id));
    return { ok: true };
  });

  app.delete('/admin/users/:id', {
    preHandler: requireAdmin(['SUPER_ADMIN']),
    schema: { params: z.object({ id: z.string().uuid() }) },
  }, async (req) => {
    const { id } = req.params as any;
    await app.db.update(schema.users).set({
      email: sql`'deleted+' || ${id} || '@example.invalid'`,
      isBanned: true, banReason: 'admin soft-delete', updatedAt: new Date(),
    }).where(eq(schema.users.id, id));
    await app.db.update(schema.refreshTokens).set({ revoked: true }).where(eq(schema.refreshTokens.userId, id));
    return { ok: true };
  });
}
