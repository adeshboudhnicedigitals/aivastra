ALTER TABLE "shopify_stores" ALTER COLUMN "widget_client_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "shopify_store_id" uuid;--> statement-breakpoint
ALTER TABLE "pose_garment_configs" ADD COLUMN "is_active" boolean;--> statement-breakpoint
ALTER TABLE "shopify_stores" ADD COLUMN "store_key" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "shopify_stores" ADD COLUMN "allowed_origins" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "jobs" ADD CONSTRAINT "jobs_shopify_store_id_shopify_stores_id_fk" FOREIGN KEY ("shopify_store_id") REFERENCES "public"."shopify_stores"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "shopify_stores" ADD CONSTRAINT "shopify_stores_store_key_unique" UNIQUE("store_key");