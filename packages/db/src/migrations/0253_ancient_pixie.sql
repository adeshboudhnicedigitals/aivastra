ALTER TABLE "shopify_product_garments" ADD COLUMN "image_url" text;--> statement-breakpoint
INSERT INTO "permissions" ("key", "description") VALUES
  ('shopify_stores.sync', 'Trigger a full product sync for a Shopify store')
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("role", "permission_id")
SELECT "r", "id" FROM "permissions", (VALUES ('SUPER_ADMIN'), ('ADMIN')) AS roles("r")
WHERE "key" = 'shopify_stores.sync'
ON CONFLICT ("role", "permission_id") DO NOTHING;
