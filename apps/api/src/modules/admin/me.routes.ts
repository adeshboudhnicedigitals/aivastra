import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { getRolePermissions, requirePermission } from './guard.js';

const ThemePreference = z.object({
  theme: z.enum(['light', 'dark', 'system']).optional(),
});

export async function adminMeRoutes(app: FastifyInstance) {
  const GUARD = requirePermission('admin.me');

  app.get('/admin/me', { preHandler: GUARD }, async (req) => {
    const [user] = await app.db
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, req.userId));
    if (!user) throw new AppError('NOT_FOUND', 404, 'user not found');

    const [adminUser] = await app.db
      .select({ preferences: schema.adminUsers.preferences })
      .from(schema.adminUsers)
      .where(eq(schema.adminUsers.userId, req.userId));

    const perms = await getRolePermissions(app, req.adminRole!);

    // SUPER_ADMIN can never have a row here (role-nav-overrides.routes.ts excludes
    // it from the editable roles), so this query is skipped rather than run and
    // discarded for the one role that would always come back empty anyway.
    const navOverrides: Record<string, boolean> = {};
    if (req.adminRole !== 'SUPER_ADMIN') {
      const rows = await app.db
        .select({
          navKey: schema.roleNavOverrides.navKey,
          visible: schema.roleNavOverrides.visible,
        })
        .from(schema.roleNavOverrides)
        .where(eq(schema.roleNavOverrides.role, req.adminRole!));
      for (const row of rows) navOverrides[row.navKey] = row.visible;
    }

    return {
      userId: req.userId,
      email: user.email,
      role: req.adminRole,
      permissions: Array.from(perms),
      navOverrides,
      preferences: adminUser?.preferences ?? {},
    };
  });

  app.patch(
    '/admin/me/preferences',
    {
      preHandler: GUARD,
      schema: { body: ThemePreference },
    },
    async (req) => {
      const { theme } = req.body as z.infer<typeof ThemePreference>;
      const preferences = theme ? { theme } : {};

      const [updated] = await app.db
        .update(schema.adminUsers)
        .set({ preferences })
        .where(eq(schema.adminUsers.userId, req.userId))
        .returning({ preferences: schema.adminUsers.preferences });

      return updated;
    },
  );
}
