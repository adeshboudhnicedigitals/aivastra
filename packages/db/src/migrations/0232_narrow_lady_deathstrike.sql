CREATE TABLE IF NOT EXISTS "whatsapp_baskets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gender_slug" text NOT NULL,
	"name" text NOT NULL,
	"representative_subcategory_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "garment_recognitions" ADD COLUMN "ranked" jsonb;--> statement-breakpoint
ALTER TABLE "garment_subcategories" ADD COLUMN "whatsapp_basket_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "whatsapp_baskets" ADD CONSTRAINT "whatsapp_baskets_representative_subcategory_id_garment_subcategories_id_fk" FOREIGN KEY ("representative_subcategory_id") REFERENCES "public"."garment_subcategories"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "whatsapp_baskets_gender_idx" ON "whatsapp_baskets" USING btree ("gender_slug","sort_order");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "garment_subcategories" ADD CONSTRAINT "garment_subcategories_whatsapp_basket_id_whatsapp_baskets_id_fk" FOREIGN KEY ("whatsapp_basket_id") REFERENCES "public"."whatsapp_baskets"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
