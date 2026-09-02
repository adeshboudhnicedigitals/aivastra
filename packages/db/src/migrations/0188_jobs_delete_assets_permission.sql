-- Custom SQL migration file, put your code below! --

INSERT INTO "permissions" ("key", "description") VALUES
  ('jobs.delete_assets', 'Delete a terminal job''s result/person image assets from storage')
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
-- Previously hardcoded to SUPER_ADMIN only (requireAdmin(['SUPER_ADMIN'])); now
-- also granted to ADMIN so team admins can clear sensitive/incorrect job assets
-- without a SUPER_ADMIN. Still gated behind the caller's own password re-check
-- in the route handler regardless of role.
INSERT INTO "role_permissions" ("role", "permission_id")
SELECT r.role, "id" FROM "permissions"
CROSS JOIN (VALUES ('SUPER_ADMIN'), ('ADMIN')) AS r(role)
WHERE "key" = 'jobs.delete_assets'
ON CONFLICT ("role", "permission_id") DO NOTHING;
