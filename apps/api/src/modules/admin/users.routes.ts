import { schema } from '@aivastra/db';
import { UpdateUserBody } from '@aivastra/types';
import { and, count, desc, eq, ilike, isNotNull, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { requireAdmin } from './guard.js';

const PaginatedSearch = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
});

export async function adminUsersRoutes(app: FastifyInstance) {
  const ALL = requireAdmin(['SUPER_ADMIN', 'MODERATOR', 'SUPPORT', 'ADMIN']);
  const WRITE = requireAdmin(['SUPER_ADMIN', 'MODERATOR', 'ADMIN']);

  app.get(
    '/admin/users',
    { preHandler: ALL, schema: { querystring: PaginatedSearch } },
    async (req) => {
      const { page, pageSize, search } = req.query as z.infer<typeof PaginatedSearch>;

      const where = search
        ? or(
            ilike(schema.users.email, `%${search}%`),
            ilike(schema.users.displayName, `%${search}%`),
          )
        : undefined;

      const [{ total }] = await app.db.select({ total: count() }).from(schema.users).where(where);

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
          isAdmin: isNotNull(schema.adminUsers.id),
          adminRole: schema.adminUsers.role,
          hasPassword: isNotNull(schema.users.passwordHash),
        })
        .from(schema.users)
        .leftJoin(schema.userCredits, eq(schema.userCredits.userId, schema.users.id))
        .leftJoin(schema.jobs, eq(schema.jobs.userId, schema.users.id))
        .leftJoin(schema.adminUsers, eq(schema.adminUsers.userId, schema.users.id))
        .where(where)
        .groupBy(schema.users.id, schema.userCredits.balance, schema.adminUsers.id)
        .orderBy(desc(schema.users.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      return { page, pageSize, total, items: rows };
    },
  );

  app.get(
    '/admin/users/:id',
    {
      preHandler: ALL,
      schema: { params: z.object({ id: z.string().uuid() }) },
    },
    async (req) => {
      const { id } = req.params as { id: string };
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
          isAdmin: isNotNull(schema.adminUsers.id),
          adminRole: schema.adminUsers.role,
          hasPassword: isNotNull(schema.users.passwordHash),
        })
        .from(schema.users)
        .leftJoin(schema.adminUsers, eq(schema.adminUsers.userId, schema.users.id))
        .where(eq(schema.users.id, id));
      const [credits] = await app.db
        .select()
        .from(schema.userCredits)
        .where(eq(schema.userCredits.userId, id));
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
    },
  );

  app.patch(
    '/admin/users/:id',
    {
      preHandler: WRITE,
      schema: { params: z.object({ id: z.string().uuid() }), body: UpdateUserBody },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const { tier, isBanned, banReason, forceLogout } = req.body as z.infer<typeof UpdateUserBody>;

      if (tier !== undefined) {
        const [plan] = await app.db
          .select({ slug: schema.creditPlans.slug })
          .from(schema.creditPlans)
          .where(and(eq(schema.creditPlans.slug, tier), eq(schema.creditPlans.isActive, true)));
        if (!plan)
          throw new AppError('BAD_REQUEST', 400, 'tier must be an active credit plan slug');
      }

      if (isBanned) {
        const [adminRow] = await app.db
          .select({ id: schema.adminUsers.id })
          .from(schema.adminUsers)
          .where(eq(schema.adminUsers.userId, id));
        if (adminRow) throw new AppError('FORBIDDEN', 403, 'cannot suspend an admin user');
      }

      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (tier !== undefined) patch.tier = tier;
      if (isBanned !== undefined) patch.isBanned = isBanned;
      if (banReason !== undefined) patch.banReason = banReason;
      await app.db.update(schema.users).set(patch).where(eq(schema.users.id, id));
      if (forceLogout)
        await app.db
          .update(schema.refreshTokens)
          .set({ revokedAt: new Date() })
          .where(eq(schema.refreshTokens.userId, id));
      return { ok: true };
    },
  );

  app.delete(
    '/admin/users/:id',
    {
      preHandler: requireAdmin(['SUPER_ADMIN']),
      schema: { params: z.object({ id: z.string().uuid() }) },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const [adminRow] = await app.db
        .select({ id: schema.adminUsers.id })
        .from(schema.adminUsers)
        .where(eq(schema.adminUsers.userId, id));
      if (adminRow) throw new AppError('FORBIDDEN', 403, 'cannot delete an admin user');

      await app.db
        .update(schema.users)
        .set({
          email: sql`'deleted+' || ${id} || '@example.invalid'`,
          isBanned: true,
          banReason: 'admin soft-delete',
          updatedAt: new Date(),
        })
        .where(eq(schema.users.id, id));
      await app.db
        .update(schema.refreshTokens)
        .set({ revokedAt: new Date() })
        .where(eq(schema.refreshTokens.userId, id));
      return { ok: true };
    },
  );

  // Admin request management (SUPER_ADMIN only)
  const SUPER = requireAdmin(['SUPER_ADMIN']);

  app.get('/admin/admin-requests', { preHandler: SUPER }, async () => {
    const rows = await app.db
      .select({
        userId: schema.adminUsers.userId,
        email: schema.users.email,
        displayName: schema.users.displayName,
        role: schema.adminUsers.role,
        requestedAt: schema.adminUsers.createdAt,
      })
      .from(schema.adminUsers)
      .innerJoin(schema.users, eq(schema.adminUsers.userId, schema.users.id))
      .where(eq(schema.adminUsers.status, 'pending'))
      .orderBy(schema.adminUsers.createdAt);
    return { items: rows };
  });

  app.post(
    '/admin/admin-requests/:userId/approve',
    {
      preHandler: SUPER,
      schema: { params: z.object({ userId: z.string().uuid() }) },
    },
    async (req) => {
      const { userId } = req.params as { userId: string };
      const [userRecord] = await app.db
        .select({ passwordHash: schema.users.passwordHash })
        .from(schema.users)
        .where(eq(schema.users.id, userId));
      const [row] = await app.db
        .update(schema.adminUsers)
        .set({ status: 'active', passwordHash: userRecord?.passwordHash ?? null })
        .where(and(eq(schema.adminUsers.userId, userId), eq(schema.adminUsers.status, 'pending')))
        .returning({ userId: schema.adminUsers.userId });
      if (!row) throw new AppError('NOT_FOUND', 404, 'no pending admin request for this user');
      return { ok: true, status: 'active' };
    },
  );

  app.post(
    '/admin/admin-requests/:userId/reject',
    {
      preHandler: SUPER,
      schema: { params: z.object({ userId: z.string().uuid() }) },
    },
    async (req) => {
      const { userId } = req.params as { userId: string };
      const [row] = await app.db
        .update(schema.adminUsers)
        .set({ status: 'rejected' })
        .where(and(eq(schema.adminUsers.userId, userId), eq(schema.adminUsers.status, 'pending')))
        .returning({ userId: schema.adminUsers.userId });
      if (!row) throw new AppError('NOT_FOUND', 404, 'no pending admin request for this user');
      return { ok: true, status: 'rejected' };
    },
  );

  app.post(
    '/admin/admin-users',
    {
      preHandler: SUPER,
      schema: {
        body: z.object({
          userId: z.string().uuid(),
          role: z.enum(['ADMIN', 'MODERATOR', 'SUPPORT']).default('ADMIN'),
        }),
      },
    },
    async (req) => {
      const { userId, role } = req.body as { userId: string; role: string };
      const [user] = await app.db
        .select({ id: schema.users.id, passwordHash: schema.users.passwordHash })
        .from(schema.users)
        .where(eq(schema.users.id, userId));
      if (!user) throw new AppError('NOT_FOUND', 404, 'user not found');
      await app.db
        .insert(schema.adminUsers)
        .values({ userId, role, status: 'active', passwordHash: user.passwordHash })
        .onConflictDoUpdate({
          target: schema.adminUsers.userId,
          set: { role, status: 'active', passwordHash: user.passwordHash },
        });
      return { ok: true, role, status: 'active' };
    },
  );

  app.delete(
    '/admin/admin-users/:userId',
    {
      preHandler: SUPER,
      schema: { params: z.object({ userId: z.string().uuid() }) },
    },
    async (req) => {
      const { userId } = req.params as { userId: string };
      if (userId === req.userId) {
        throw new AppError('FORBIDDEN', 403, 'cannot revoke your own admin access');
      }
      await app.db.delete(schema.adminUsers).where(eq(schema.adminUsers.userId, userId));
      return { ok: true };
    },
  );
}
