-- Minting credits for a merchant (POST /admin/merchants/:id/credits) was guarded only by
-- merchants.write, so anyone who could edit a merchant could mint credits for it, while user
-- grants need credits.write. This adds a dedicated credits.grant permission and seeds it onto
-- every role that holds credits.write today, so no admin silently loses an ability they use;
-- SUPER_ADMIN then narrows it in the Roles & Permissions editor. Deduct stays on credits.write.
INSERT INTO "permissions" ("key", "description") VALUES
  ('credits.grant', 'Grant credits to a merchant account')
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("role", "permission_id")
SELECT rp."role", g."id"
FROM "role_permissions" rp
JOIN "permissions" w ON w."id" = rp."permission_id" AND w."key" = 'credits.write'
CROSS JOIN "permissions" g
WHERE g."key" = 'credits.grant'
ON CONFLICT ("role", "permission_id") DO NOTHING;
--> statement-breakpoint
-- SUPER_ADMIN keeps everything even if the matrix had no credits.write row for it.
INSERT INTO "role_permissions" ("role", "permission_id")
SELECT 'SUPER_ADMIN', "id" FROM "permissions" WHERE "key" = 'credits.grant'
ON CONFLICT ("role", "permission_id") DO NOTHING;
