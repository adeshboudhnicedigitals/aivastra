-- Custom SQL migration file, put your code below! --

-- The Payments nav item (and its two routes) used a hardcoded
-- requireAdmin(['SUPER_ADMIN','SUPPORT','ADMIN']) instead of a permission key, which
-- meant there was no row for it in the Roles & Permissions matrix and no way to
-- revoke SUPPORT's access to it without a code change. This grants the same three
-- roles that already had hardcoded access, preserving current behavior while making
-- it toggleable going forward.
INSERT INTO "permissions" ("key", "description") VALUES
  ('payments.read', 'View payments and (re)generate invoices')
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("role", "permission_id")
SELECT r.role, "id" FROM "permissions"
CROSS JOIN (VALUES ('SUPER_ADMIN'), ('ADMIN'), ('SUPPORT')) AS r(role)
WHERE "key" = 'payments.read'
ON CONFLICT ("role", "permission_id") DO NOTHING;