-- Custom SQL migration file, put your code below! --

INSERT INTO "permissions" ("key", "description") VALUES
  ('fleet.view', 'View the GPU fleet operations dashboard (read-only)'),
  ('fleet.operate', 'Run GPU fleet operations actions (drain, reserve, job actions)')
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("role", "permission_id")
SELECT r.role, "id" FROM "permissions"
CROSS JOIN (VALUES ('SUPER_ADMIN'), ('ADMIN')) AS r(role)
WHERE "key" = 'fleet.view'
ON CONFLICT ("role", "permission_id") DO NOTHING;
--> statement-breakpoint
-- fleet.operate is SUPER_ADMIN only for now: no route is gated by it yet, and widening a
-- grant later is a one-line migration while narrowing one after the fact is not.
INSERT INTO "role_permissions" ("role", "permission_id")
SELECT 'SUPER_ADMIN', "id" FROM "permissions"
WHERE "key" = 'fleet.operate'
ON CONFLICT ("role", "permission_id") DO NOTHING;
