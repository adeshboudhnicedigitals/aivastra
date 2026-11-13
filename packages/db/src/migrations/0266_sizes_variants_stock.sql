CREATE TABLE IF NOT EXISTS "merchant_catalog_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"catalog_item_id" uuid NOT NULL,
	"size" text NOT NULL,
	"is_custom" boolean DEFAULT false NOT NULL,
	"standard_size" text,
	"colour" text DEFAULT '' NOT NULL,
	"sku" text,
	"barcode" text,
	"price_override_paise" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "variant_branch_stock" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"status" text NOT NULL,
	"quantity" integer,
	"source" text DEFAULT 'manual' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_staff_id" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "size_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"sizes" jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "size_sets_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "garment_subcategories" ADD COLUMN "size_set_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "merchant_catalog_variants" ADD CONSTRAINT "merchant_catalog_variants_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "merchant_catalog_variants" ADD CONSTRAINT "merchant_catalog_variants_catalog_item_id_merchant_catalog_items_id_fk" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."merchant_catalog_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "variant_branch_stock" ADD CONSTRAINT "variant_branch_stock_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "variant_branch_stock" ADD CONSTRAINT "variant_branch_stock_variant_id_merchant_catalog_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."merchant_catalog_variants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "variant_branch_stock" ADD CONSTRAINT "variant_branch_stock_branch_id_merchant_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."merchant_branches"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "variant_branch_stock" ADD CONSTRAINT "variant_branch_stock_updated_by_staff_id_merchant_staff_id_fk" FOREIGN KEY ("updated_by_staff_id") REFERENCES "public"."merchant_staff"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "merchant_catalog_variants_item_size_colour_uq" ON "merchant_catalog_variants" USING btree ("catalog_item_id","size","colour");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "merchant_catalog_variants_merchant_barcode_uq" ON "merchant_catalog_variants" USING btree ("merchant_id","barcode") WHERE "merchant_catalog_variants"."barcode" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "variant_branch_stock_variant_branch_uq" ON "variant_branch_stock" USING btree ("variant_id","branch_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "variant_branch_stock_branch_idx" ON "variant_branch_stock" USING btree ("branch_id","status");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "garment_subcategories" ADD CONSTRAINT "garment_subcategories_size_set_id_size_sets_id_fk" FOREIGN KEY ("size_set_id") REFERENCES "public"."size_sets"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- CRM phase 3 seed (plan P4): the standard size sets AiVastra curates. Idempotent on slug, so a
-- re-run or a set an admin already edited is left alone. Attaching sets to garment types is an
-- admin choice per type, so no garment_subcategories row is touched here.
INSERT INTO "size_sets" ("slug", "name", "sizes") VALUES
  ('tops-alpha', 'Tops (XS–XXXL)', '["XS","S","M","L","XL","XXL","XXXL"]'::jsonb),
  ('bottoms-waist', 'Bottoms (waist 26–44)', '["26","28","30","32","34","36","38","40","42","44"]'::jsonb),
  ('kids-age', 'Kids (by age)', '["0-1Y","1-2Y","2-3Y","3-4Y","4-5Y","5-6Y","6-7Y","7-8Y","8-9Y","9-10Y","10-12Y","12-14Y"]'::jsonb),
  ('free-size', 'Free size', '["Free size"]'::jsonb)
ON CONFLICT ("slug") DO NOTHING;
