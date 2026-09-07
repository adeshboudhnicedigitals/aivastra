CREATE TABLE IF NOT EXISTS "shopify_store_disabled_funnel_rules" (
	"store_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shopify_store_disabled_funnel_rules_store_id_rule_id_pk" PRIMARY KEY("store_id","rule_id")
);
--> statement-breakpoint
ALTER TABLE "chatbot_conversations" ALTER COLUMN "status" SET DEFAULT 'OPEN';--> statement-breakpoint
ALTER TABLE "shopify_funnel_rules" ALTER COLUMN "store_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "chatbot_conversations" ADD COLUMN "source" text DEFAULT 'chat_widget' NOT NULL;--> statement-breakpoint
ALTER TABLE "chatbot_conversations" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "chatbot_conversations" ADD COLUMN "priority" text DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE "chatbot_conversations" ADD COLUMN "subject" text;--> statement-breakpoint
ALTER TABLE "chatbot_messages" ADD COLUMN "attachment_key" text;--> statement-breakpoint
ALTER TABLE "chatbot_messages" ADD COLUMN "attachment_type" text;--> statement-breakpoint
ALTER TABLE "garment_subcategories" ADD COLUMN "tryon_library_instruction_image_key" text;--> statement-breakpoint
ALTER TABLE "garment_subcategories" ADD COLUMN "tutorial_video_url" text;--> statement-breakpoint
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