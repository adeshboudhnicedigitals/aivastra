-- Account console: the account health list, cross-merchant overview and per-account analytics
-- are gated by accounts.read. Console access is for SUPER_ADMIN and ADMIN (spec decision 8);
-- SUPER_ADMIN can widen or narrow it in the Roles & Permissions editor.
INSERT INTO "permissions" ("key", "description") VALUES
  ('accounts.read', 'View the merchant account health list, overview and per-account analytics')
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("role", "permission_id")
SELECT r.role, "id" FROM "permissions"
CROSS JOIN (VALUES ('SUPER_ADMIN'), ('ADMIN')) AS r(role)
WHERE "key" = 'accounts.read'
ON CONFLICT ("role", "permission_id") DO NOTHING;
