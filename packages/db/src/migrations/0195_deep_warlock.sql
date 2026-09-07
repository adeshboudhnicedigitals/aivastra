CREATE TABLE IF NOT EXISTS "shopify_store_disabled_funnel_rules" (
	"store_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shopify_store_disabled_funnel_rules_store_id_rule_id_pk" PRIMARY KEY("store_id","rule_id")
);
--> statement-breakpoint
-- NOTE (2026-09-07, Task 2 of the shopify-admin-support-chat plan): this migration
-- was regenerated during a renumbering pass (commit b9676cae) that resolved a
-- filename collision with migrations merged in from dev. The regeneration ran
-- against a stale snapshot that predated 0186/0187/0190, so it re-proposed
-- ADD COLUMN statements for columns those migrations already add — harmless on
-- a dev DB that had already recorded the old (pre-renumber) file hash as
-- applied, but fatal (`column already exists`) on any fresh database, which is
-- exactly what every integration test's `startContainers()` creates. Removed
-- here: the four chatbot_conversations/messages ADD COLUMNs (already in 0190)
-- and the two garment_subcategories ADD COLUMNs (already in 0186/0187). Left
-- in place: the SET DEFAULT (harmless to repeat) and everything genuinely new
-- to this migration (the funnel-rules table/constraints/index below).
ALTER TABLE "chatbot_conversations" ALTER COLUMN "status" SET DEFAULT 'OPEN';--> statement-breakpoint
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