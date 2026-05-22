import type { FastifyInstance } from 'fastify';
import { schema } from '@aivastra/db';
import { eq, sql, desc, count, ilike, or } from 'drizzle-orm';
import { z } from 'zod';
import { UpdateUserBody } from '@aivastra/types';
import { requireAdmin } from './guard';

const PaginatedSearch = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
});

export async function adminUsersRoutes(app: FastifyInstance) {
  const ALL = requireAdmin(['SUPER_ADMIN', 'MODERATOR', 'SUPPORT']);
  const WRITE = requireAdmin(['SUPER_ADMIN', 'MODERATOR']);

  app.get('/admin/users', { preHandler: ALL, schema: { querystring: PaginatedSearch } }, async (req) => {
    const { page, pageSize, search } = req.query as any;

    const where = search
      ? or(
          ilike(schema.users.email, `%${search}%`),
          ilike(schema.users.displayName, `%${search}%`),
        )
      : undefined;

    const [{ total }] = await app.db
      .select({ total: count() })
      .from(schema.users)
      .where(where);

    const rows = await app.db
      .select({
        id: schema.users.id,
        email: schema.users.email,
        displayName: schema.users.displayName,
        tier: schema.users.tier,
        isBanned: schema.users.isBanned,
        banReason: schema.users.banReason,
        createdAt: schema.users.createdAt,
        updatedAt: schema.users.updatedAt,
        balance: sql<number>`COALESCE(${schema.userCredits.balance}, 0)`,
        totalJobs: sql<number>`COUNT(${schema.jobs.id})::int`,
        lastJobAt: sql<string | null>`MAX(${schema.jobs.createdAt})`,
      })
      .from(schema.users)
      .leftJoin(schema.userCredits, eq(schema.userCredits.userId, schema.users.id))
      .leftJoin(schema.jobs, eq(schema.jobs.userId, schema.users.id))
      .where(where)
      .groupBy(schema.users.id, schema.userCredits.balance)
      .orderBy(desc(schema.users.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    return { page, pageSize, total, items: rows };
  });

  app.get('/admin/users/:id', {
    preHandler: ALL, schema: { params: z.object({ id: z.string().uuid() }) },
  }, async (req) => {
    const { id } = req.params as any;
    const [user] = await app.db
      .select({
        id: schema.users.id,
        email: schema.users.email,
        displayName: schema.users.displayName,
        tier: schema.users.tier,
        isBanned: schema.users.isBanned,
        banReason: schema.users.banReason,
        createdAt: schema.users.createdAt,
        updatedAt: schema.users.updatedAt,
      })
      .from(schema.users)
      .where(eq(schema.users.id, id));
    const [credits] = await app.db.select().from(schema.userCredits).where(eq(schema.userCredits.userId, id));
    const jobs = await app.db
      .select({
        id: schema.jobs.id,
        status: schema.jobs.status,
        createdAt: schema.jobs.createdAt,
        startedAt: schema.jobs.startedAt,
        completedAt: schema.jobs.completedAt,
        creditsCharged: schema.jobs.creditsCharged,
      })
      .from(schema.jobs)
      .where(eq(schema.jobs.userId, id))
      .orderBy(desc(schema.jobs.createdAt))
      .limit(20);
    return { ...user, balance: credits?.balance ?? 0, totalJobs: jobs.length, recentJobs: jobs };
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
