ALTER TABLE "merchant_catalog_items" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "merchant_catalog_items" ADD COLUMN "deleted_by_staff_id" uuid;--> statement-breakpoint
ALTER TABLE "merchant_catalog_items" ADD COLUMN "updated_by_staff_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "merchant_catalog_items" ADD CONSTRAINT "merchant_catalog_items_deleted_by_staff_id_merchant_staff_id_fk" FOREIGN KEY ("deleted_by_staff_id") REFERENCES "public"."merchant_staff"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "merchant_catalog_items" ADD CONSTRAINT "merchant_catalog_items_updated_by_staff_id_merchant_staff_id_fk" FOREIGN KEY ("updated_by_staff_id") REFERENCES "public"."merchant_staff"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
