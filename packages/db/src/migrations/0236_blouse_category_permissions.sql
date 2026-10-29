INSERT INTO "permissions" ("key", "description") VALUES
  ('blouse_categories.write', 'Create and update blouse categories, poses, and their garment-type mappings'),
  ('blouse_categories.delete', 'Delete blouse categories and poses')
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("role", "permission_id")
SELECT 'SUPER_ADMIN', "id" FROM "permissions" WHERE "key" IN ('blouse_categories.write', 'blouse_categories.delete')
ON CONFLICT ("role", "permission_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("role", "permission_id")
SELECT 'ADMIN', "id" FROM "permissions" WHERE "key" = 'blouse_categories.write'
ON CONFLICT ("role", "permission_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("role", "permission_id")
SELECT 'MODERATOR', "id" FROM "permissions" WHERE "key" IN ('blouse_categories.write', 'blouse_categories.delete')
ON CONFLICT ("role", "permission_id") DO NOTHING;
