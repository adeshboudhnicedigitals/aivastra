CREATE TABLE IF NOT EXISTS "shopify_store_disabled_funnel_rules" (
	"store_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shopify_store_disabled_funnel_rules_store_id_rule_id_pk" PRIMARY KEY("store_id","rule_id")
);
--> statement-breakpoint
ALTER TABLE "shopify_funnel_rules" ALTER COLUMN "store_id" DROP NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shopify_store_disabled_funnel_rules" ADD CONSTRAINT "shopify_store_disabled_funnel_rules_store_id_shopify_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."shopify_stores"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shopify_store_disabled_funnel_rules" ADD CONSTRAINT "shopify_store_disabled_funnel_rules_rule_id_shopify_funnel_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."shopify_funnel_rules"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "shopify_funnel_rules_one_global_per_basket_idx" ON "shopify_funnel_rules" USING btree ("funnel_template_id") WHERE "shopify_funnel_rules"."store_id" is null;--> statement-breakpoint
ALTER TABLE "shopify_funnel_rules" DROP COLUMN IF EXISTS "mode";
--> statement-breakpoint
-- Rows with a pin predate this feature and can only have come from the admin
-- reassign-on-basket-delete path (admin/shopify-funnels.routes.ts). Without
-- this, the Manage page renders a "Pinned" badge with no explanation of who
-- set it.
UPDATE "shopify_product_garments"
SET "funnel_assignment_source" = 'admin_reassign'
WHERE "funnel_template_id" IS NOT NULL
  AND "funnel_assignment_source" IS NULL;
