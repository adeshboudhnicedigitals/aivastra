CREATE TABLE IF NOT EXISTS "cart_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cart_id" uuid NOT NULL,
	"merchant_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"catalog_item_id" uuid NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"added_by" text NOT NULL,
	"added_by_staff_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	"billed_at" timestamp with time zone,
	"billed_source" text,
	"billed_price_paise" integer,
	"billed_by_staff_id" uuid,
	"session_item_ids" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "carts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"cart_code" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cart_lines" ADD CONSTRAINT "cart_lines_cart_id_carts_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."carts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cart_lines" ADD CONSTRAINT "cart_lines_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cart_lines" ADD CONSTRAINT "cart_lines_variant_id_merchant_catalog_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."merchant_catalog_variants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cart_lines" ADD CONSTRAINT "cart_lines_added_by_staff_id_merchant_staff_id_fk" FOREIGN KEY ("added_by_staff_id") REFERENCES "public"."merchant_staff"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cart_lines" ADD CONSTRAINT "cart_lines_billed_by_staff_id_merchant_staff_id_fk" FOREIGN KEY ("billed_by_staff_id") REFERENCES "public"."merchant_staff"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "carts" ADD CONSTRAINT "carts_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "carts" ADD CONSTRAINT "carts_branch_id_merchant_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."merchant_branches"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "carts" ADD CONSTRAINT "carts_session_id_instore_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."instore_sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cart_lines_cart_idx" ON "cart_lines" USING btree ("cart_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "carts_session_uq" ON "carts" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "carts_cart_code_uq" ON "carts" USING btree ("cart_code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "carts_open_created_idx" ON "carts" USING btree ("created_at") WHERE "carts"."status" = 'open';