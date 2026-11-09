-- Custom SQL migration file, put your code below! --

-- 'admin_users.manage' was doing two unrelated jobs: gating admin-account approval
-- (apps/api/src/modules/admin/users.routes.ts's admin-requests endpoints — itself
-- labeled "SUPER_ADMIN only" in a comment there) *and* gating the Roles & Permissions
-- and Sidebar Visibility settings tabs. SUPPORT having the one grant meant it got
-- both, including the ability to edit its own role's permissions. Splitting the
-- settings-matrix half into its own key lets it be revoked for SUPPORT without
-- touching admin_users.manage (left exactly as-is, still ADMIN/SUPER_ADMIN/SUPPORT —
-- not part of this ask).
INSERT INTO "permissions" ("key", "description") VALUES
  ('role_config.manage', 'Edit the Roles & Permissions and Sidebar Visibility settings tabs')
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
-- Matches admin_users.manage's current distribution minus SUPPORT, so ADMIN's
-- existing access to these two tabs is unaffected by the split.
INSERT INTO "role_permissions" ("role", "permission_id")
SELECT r.role, "id" FROM "permissions"
CROSS JOIN (VALUES ('SUPER_ADMIN'), ('ADMIN')) AS r(role)
WHERE "key" = 'role_config.manage'
ON CONFLICT ("role", "permission_id") DO NOTHING;