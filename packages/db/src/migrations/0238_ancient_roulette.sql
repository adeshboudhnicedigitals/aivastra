ALTER TABLE "garment_subcategories" ADD COLUMN "explicit_lower_mappings_configured" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "garment_subcategories" ADD COLUMN "explicit_shoe_mappings_configured" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "garment_subcategories" ADD COLUMN "explicit_face_mappings_configured" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "garment_subcategories" ADD COLUMN "explicit_background_mappings_configured" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Backfill: every garment type that already has explicit rows in the relevant
-- join table today was, by definition, already "configured" under the old
-- row-count check. Without this backfill the new flag would default to false
-- for all of them and every already-configured type would revert to
-- "show everything" the moment this migration ships — the exact bug this
-- migration exists to fix, applied retroactively to every live mapping.
UPDATE "garment_subcategories" SET "explicit_lower_mappings_configured" = true
WHERE "id" IN (
  SELECT DISTINCT "cis"."subcategory_id" FROM "catalog_item_subcategories" "cis"
  INNER JOIN "catalog_items" "ci" ON "ci"."id" = "cis"."catalog_item_id"
  WHERE "ci"."type" = 'lower'
);--> statement-breakpoint
UPDATE "garment_subcategories" SET "explicit_shoe_mappings_configured" = true
WHERE "id" IN (
  SELECT DISTINCT "cis"."subcategory_id" FROM "catalog_item_subcategories" "cis"
  INNER JOIN "catalog_items" "ci" ON "ci"."id" = "cis"."catalog_item_id"
  WHERE "ci"."type" = 'shoe'
);--> statement-breakpoint
UPDATE "garment_subcategories" SET "explicit_face_mappings_configured" = true
WHERE "id" IN (SELECT DISTINCT "subcategory_id" FROM "model_face_subcategories");--> statement-breakpoint
UPDATE "garment_subcategories" SET "explicit_background_mappings_configured" = true
WHERE "id" IN (SELECT DISTINCT "subcategory_id" FROM "model_background_subcategories");