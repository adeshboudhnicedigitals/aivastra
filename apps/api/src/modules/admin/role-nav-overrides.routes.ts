import { schema } from '@aivastra/db';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { recordAudit } from './audit.js';
import { requirePermission } from './guard.js';

// Same exclusion as role-permissions.routes.ts and for the same reason: SUPER_ADMIN's
// sidebar can't be edited here, so a misconfigured override can never lock the one
// account that recovers everything else out of its own admin panel.
const EDITABLE_ROLES = ['ADMIN', 'MODERATOR', 'SUPPORT'] as const;

// This is a visibility overlay, not a second permission system — a (role, navKey) row
// only ever decides whether the sidebar *shows* that item for that role. It never
// grants or blocks the underlying API calls; a role shown a nav item it lacks the
// permission for will still get a 403 from that page, same as typing the URL by hand
// today. Whoever edits this matrix is expected to pair a "show" override with the
// matching permission grant in the Roles & Permissions tab above it.
const PatchBody = z.object({
  role: z.enum(EDITABLE_ROLES),
  navKey: z.string().min(1),
  // null clears the override and reverts to the permission-driven default.
  visible: z.boolean().nullable(),
});

export async function adminRoleNavOverridesRoutes(app: FastifyInstance) {
  // Same key as role-permissions.routes.ts's GUARD — these two tabs live side by
  // side in Settings and are meant to be edited by the same people.
  const GUARD = requirePermission('role_config.manage');

  app.get('/admin/role-nav-overrides', { preHandler: GUARD }, async () => {
    const rows = await app.db
      .select({
        role: schema.roleNavOverrides.role,
        navKey: schema.roleNavOverrides.navKey,
        visible: schema.roleNavOverrides.visible,
      })
      .from(schema.roleNavOverrides);

    const matrix: Record<string, Record<string, boolean>> = {
      ADMIN: {},
      MODERATOR: {},
      SUPPORT: {},
    };
    for (const row of rows) {
      if (row.role in matrix) matrix[row.role][row.navKey] = row.visible;
    }

    return { editableRoles: EDITABLE_ROLES, overrides: matrix };
  });

  app.patch(
    '/admin/role-nav-overrides',
    { preHandler: GUARD, schema: { body: PatchBody } },
    async (req) => {
      const { role, navKey, visible } = req.body as z.infer<typeof PatchBody>;

      await app.db.transaction(async (tx) => {
        if (visible === null) {
          await tx
            .delete(schema.roleNavOverrides)
            .where(
              and(
                eq(schema.roleNavOverrides.role, role),
                eq(schema.roleNavOverrides.navKey, navKey),
              ),
            );
        } else {
          await tx
            .insert(schema.roleNavOverrides)
            .values({ role, navKey, visible })
            .onConflictDoUpdate({
              target: [schema.roleNavOverrides.role, schema.roleNavOverrides.navKey],
              set: { visible },
            });
        }

        await recordAudit(tx, {
          actor: { userId: req.userId, role: req.adminRole ?? '' },
          action: 'role_nav_overrides.set',
          resourceType: 'role_nav_overrides',
          resourceId: role,
          after: { role, navKey, visible },
          request: req,
        });
      });

      return { ok: true, role, navKey, visible };
    },
  );
}
