-- Two unrelated schema changes bundled here because drizzle-kit generate picks up
-- ALL pending drift at once, not just what one person is working on:
-- 1) pose_garment_configs.is_active — already defined in models.ts since commit
--    a0350d6 ("scope pose active toggle to garment type") but never migrated.
--    Nullable, no backfill needed.
-- 2) merchants.website_url / company_size / purpose — dropped: confirmed zero
--    references anywhere in dispatcher/kiosk/widget job-processing code, pure
--    cosmetic admin-profile fields with no functional impact.
ALTER TABLE "pose_garment_configs" ADD COLUMN "is_active" boolean;--> statement-breakpoint
ALTER TABLE "merchants" DROP COLUMN IF EXISTS "website_url";--> statement-breakpoint
ALTER TABLE "merchants" DROP COLUMN IF EXISTS "company_size";--> statement-breakpoint
ALTER TABLE "merchants" DROP COLUMN IF EXISTS "purpose";