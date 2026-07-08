-- Backfills a gap in this repo's migration history, not a real schema change.
--
-- packages/db/src/migrations/meta/ was missing the snapshot json for every
-- migration between 0046 and 0088 (only 0000/0001/0032/0045 were ever
-- committed, despite _journal.json listing 89 entries). Without those
-- snapshots, `drizzle-kit generate` has no accurate record of the schema
-- between 0045 and today, so this file is what it produces when forced to
-- diff straight from the stale 0045 baseline against the current (real,
-- already-applied) schema: every table/column added since 0045 shows up as
-- "new", and objects renamed/dropped since 0045 (e.g. model_poses ->
-- model_pose_assets) show up as unguarded DROPs.
--
-- Every statement below describes something that ALREADY happened via the
-- real, historical migrations 0046-0088 (already applied to every
-- environment). This file exists purely so `pnpm db:migrate`'s hash-tracking
-- table has a record for it and `pnpm db:generate` has an accurate snapshot
-- baseline to diff against going forward -- it is intentionally never meant
-- to run cleanly start-to-finish. This repo's custom migrate.ts runner
-- (see that file's own header) wraps each migration in one transaction and
-- reconciles "already applied" errors (undefined/duplicate table, column,
-- constraint) by recording the hash without applying anything, which is
-- exactly what happens here: the unguarded `DROP TABLE "model_poses" CASCADE`
-- near the end is guaranteed to fail (that table no longer exists), rolling
-- back this entire transaction and reconciling it as a no-op. Confirmed via
-- direct psql inspection before this file was committed: the live dev
-- database already matches every statement's target state exactly.
--
-- If you are adding a new migration after this one: nothing about this file
-- should ever need to run or be edited again. If `pnpm db:generate` ever
-- proposes touching model_poses/model_pose_assets again, stop and
-- investigate rather than assuming it is another instance of this same gap.
CREATE TABLE IF NOT EXISTS "chatbot_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'BOT' NOT NULL,
	"assigned_agent_id" uuid,
	"escalation_reason" text,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chatbot_embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"qna_id" uuid NOT NULL,
	"content" text NOT NULL,
	"content_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
	"embedding" vector(1536) NOT NULL,
	"embedded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chatbot_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"type" text NOT NULL,
	"actor_id" uuid,
	"from_status" text,
	"to_status" text,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chatbot_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" text NOT NULL,
	"sender_id" uuid,
	"content" text NOT NULL,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chatbot_qna" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contact_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"source" text,
	"message" text,
	"attachment_key" text,
	"status" text DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pose_garment_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pose_asset_id" uuid NOT NULL,
	"subcategory_id" uuid NOT NULL,
	"workflow_template_id" uuid,
	"prompt_garment_phase" text,
	"prompt_face_phase" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pose_garment_configs_pose_subcat_unique" UNIQUE("pose_asset_id","subcategory_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "saree_settings" (
	"id" uuid PRIMARY KEY DEFAULT '00000000-0000-0000-0000-000000000001'::uuid NOT NULL,
	"model_image_key" text,
	"model_image_thumb_key" text,
	"sample_saree_image_key" text,
	"sample_saree_image_thumb_key" text,
	"workflow_template_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shopify_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"price_cents" integer NOT NULL,
	"included_tryons" integer NOT NULL,
	"overage_cents" integer NOT NULL,
	"trial_days" integer DEFAULT 7 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shopify_product_garments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"shopify_product_id" bigint NOT NULL,
	"shopify_variant_id" bigint,
	"r2_key" text NOT NULL,
	"status" text DEFAULT 'processing' NOT NULL,
	"failed_reason" text,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shopify_product_garments_store_id_shopify_product_id_shopify_variant_id_unique" UNIQUE("store_id","shopify_product_id","shopify_variant_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shopify_stores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"widget_client_id" uuid NOT NULL,
	"shop_domain" text NOT NULL,
	"shopify_shop_id" bigint NOT NULL,
	"access_token" text NOT NULL,
	"scope" text NOT NULL,
	"billing_plan_id" bigint,
	"shopify_plan_id" uuid,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uninstalled_at" timestamp with time zone,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sync_cursor" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shopify_stores_widget_client_id_unique" UNIQUE("widget_client_id"),
	CONSTRAINT "shopify_stores_shop_domain_unique" UNIQUE("shop_domain"),
	CONSTRAINT "shopify_stores_shopify_shop_id_unique" UNIQUE("shopify_shop_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tryon_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"workflow_template_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tryon_categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tryon_category_samples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"r2_key" text NOT NULL,
	"thumbnail_key" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tryon_settings" (
	"id" uuid PRIMARY KEY DEFAULT '00000000-0000-0000-0000-000000000001'::uuid NOT NULL,
	"person_sample_key" text,
	"person_sample_thumb_key" text,
	"garment_sample_key" text,
	"garment_sample_thumb_key" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "merchant_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"widget_client_id" uuid NOT NULL,
	"plan_id" text NOT NULL,
	"razorpay_order_id" text NOT NULL,
	"razorpay_payment_id" text,
	"razorpay_signature" text,
	"base_paise" integer NOT NULL,
	"gst_paise" integer NOT NULL,
	"total_paise" integer NOT NULL,
	"credits" integer NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	CONSTRAINT "merchant_payments_razorpay_order_id_unique" UNIQUE("razorpay_order_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "widget_client_credits" (
	"widget_client_id" uuid PRIMARY KEY NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "widget_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_name" text NOT NULL,
	"contact_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"website_url" text NOT NULL,
	"company_size" text NOT NULL,
	"purpose" text NOT NULL,
	"business_address" text NOT NULL,
	"password_hash" text NOT NULL,
	"widget_key" uuid DEFAULT gen_random_uuid() NOT NULL,
	"client_type" text DEFAULT 'merchant' NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"allowed_origins" text[] DEFAULT '{}' NOT NULL,
	"webhook_url" text,
	"webhook_secret" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "widget_clients_email_unique" UNIQUE("email"),
	CONSTRAINT "widget_clients_widget_key_unique" UNIQUE("widget_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "widget_credit_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"widget_client_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"reason" text NOT NULL,
	"job_id" uuid,
	"admin_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workers" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"url" text NOT NULL,
	"api_key" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"allowed_job_types" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "model_poses" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "model_poses" CASCADE;--> statement-breakpoint
ALTER TABLE "job_inputs" DROP CONSTRAINT "job_inputs_pose_id_model_poses_id_fk";
--> statement-breakpoint
ALTER TABLE "model_pose_assets" DROP CONSTRAINT "model_pose_assets_face_id_model_faces_id_fk";
--> statement-breakpoint
ALTER TABLE "model_pose_assets" DROP CONSTRAINT "model_pose_assets_background_id_model_backgrounds_id_fk";
--> statement-breakpoint
ALTER TABLE "job_inputs" ALTER COLUMN "face_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "job_inputs" ALTER COLUMN "background_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "job_inputs" ALTER COLUMN "pose_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "tier" SET DEFAULT 'free';--> statement-breakpoint
ALTER TABLE "admin_users" ADD COLUMN "preferences" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "credit_plans" ADD COLUMN "queue_stream" text DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_plans" ADD COLUMN "watermark" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "job_inputs" ADD COLUMN "garment_type_id" uuid;--> statement-breakpoint
ALTER TABLE "job_outputs" ADD COLUMN "asset_kind" text DEFAULT 'ORIGINAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "job_outputs" ADD COLUMN "watermark_version" smallint;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "queue_stream" text DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "watermark" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "parent_job_id" uuid;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "widget_client_id" uuid;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "customer_photo_key" text;--> statement-breakpoint
ALTER TABLE "garment_subcategories" ADD COLUMN "instruction_image_key" text;--> statement-breakpoint
ALTER TABLE "garment_subcategories" ADD COLUMN "tryon_category_id" uuid;--> statement-breakpoint
ALTER TABLE "model_backgrounds" ADD COLUMN "bg_comfy_r2_key" text;--> statement-breakpoint
ALTER TABLE "model_backgrounds" ADD COLUMN "category_id" integer;--> statement-breakpoint
ALTER TABLE "model_backgrounds" ADD COLUMN "tags" text[] DEFAULT ARRAY[]::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "model_backgrounds" ADD COLUMN "special_tag" text;--> statement-breakpoint
ALTER TABLE "model_faces" ADD COLUMN "face_side_r2_key" text;--> statement-breakpoint
ALTER TABLE "model_pose_assets" ADD COLUMN "prompt_face_phase" text;--> statement-breakpoint
ALTER TABLE "model_pose_assets" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "model_pose_assets" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_templates" ADD COLUMN "latent_size_node_ids" text[] DEFAULT ARRAY[]::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_templates" ADD COLUMN "latent_max_px" integer DEFAULT 2048 NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_templates" ADD COLUMN "output_size_node_ids" text[] DEFAULT ARRAY[]::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_templates" ADD COLUMN "output_max_px" integer DEFAULT 2048 NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_templates" ADD COLUMN "result_node_id" text;--> statement-breakpoint
ALTER TABLE "workflow_templates" ADD COLUMN "workflow_type" text DEFAULT 'regular' NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_templates" ADD COLUMN "widget_garment_node_id" text;--> statement-breakpoint
ALTER TABLE "workflow_templates" ADD COLUMN "widget_customer_photo_node_id" text;--> statement-breakpoint
ALTER TABLE "workflow_templates" ADD COLUMN "widget_output_node_id" text;--> statement-breakpoint
ALTER TABLE "workflow_templates" ADD COLUMN "tryon_person_node_id" text;--> statement-breakpoint
ALTER TABLE "workflow_templates" ADD COLUMN "tryon_garment_node_id" text;--> statement-breakpoint
ALTER TABLE "workflow_templates" ADD COLUMN "tryon_output_node_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "company_name" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chatbot_conversations" ADD CONSTRAINT "chatbot_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chatbot_conversations" ADD CONSTRAINT "chatbot_conversations_assigned_agent_id_admin_users_id_fk" FOREIGN KEY ("assigned_agent_id") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chatbot_embeddings" ADD CONSTRAINT "chatbot_embeddings_qna_id_chatbot_qna_id_fk" FOREIGN KEY ("qna_id") REFERENCES "public"."chatbot_qna"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chatbot_events" ADD CONSTRAINT "chatbot_events_conversation_id_chatbot_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chatbot_conversations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chatbot_messages" ADD CONSTRAINT "chatbot_messages_conversation_id_chatbot_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chatbot_conversations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contact_requests" ADD CONSTRAINT "contact_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pose_garment_configs" ADD CONSTRAINT "pose_garment_configs_pose_asset_id_model_pose_assets_id_fk" FOREIGN KEY ("pose_asset_id") REFERENCES "public"."model_pose_assets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pose_garment_configs" ADD CONSTRAINT "pose_garment_configs_subcategory_id_garment_subcategories_id_fk" FOREIGN KEY ("subcategory_id") REFERENCES "public"."garment_subcategories"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pose_garment_configs" ADD CONSTRAINT "pose_garment_configs_workflow_template_id_workflow_templates_id_fk" FOREIGN KEY ("workflow_template_id") REFERENCES "public"."workflow_templates"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "saree_settings" ADD CONSTRAINT "saree_settings_workflow_template_id_workflow_templates_id_fk" FOREIGN KEY ("workflow_template_id") REFERENCES "public"."workflow_templates"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shopify_product_garments" ADD CONSTRAINT "shopify_product_garments_store_id_shopify_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."shopify_stores"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shopify_stores" ADD CONSTRAINT "shopify_stores_widget_client_id_widget_clients_id_fk" FOREIGN KEY ("widget_client_id") REFERENCES "public"."widget_clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shopify_stores" ADD CONSTRAINT "shopify_stores_shopify_plan_id_shopify_plans_id_fk" FOREIGN KEY ("shopify_plan_id") REFERENCES "public"."shopify_plans"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tryon_categories" ADD CONSTRAINT "tryon_categories_workflow_template_id_workflow_templates_id_fk" FOREIGN KEY ("workflow_template_id") REFERENCES "public"."workflow_templates"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tryon_category_samples" ADD CONSTRAINT "tryon_category_samples_category_id_tryon_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."tryon_categories"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "merchant_payments" ADD CONSTRAINT "merchant_payments_widget_client_id_widget_clients_id_fk" FOREIGN KEY ("widget_client_id") REFERENCES "public"."widget_clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "widget_client_credits" ADD CONSTRAINT "widget_client_credits_widget_client_id_widget_clients_id_fk" FOREIGN KEY ("widget_client_id") REFERENCES "public"."widget_clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "widget_credit_ledger" ADD CONSTRAINT "widget_credit_ledger_widget_client_id_widget_clients_id_fk" FOREIGN KEY ("widget_client_id") REFERENCES "public"."widget_clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chatbot_conversations_one_active_idx" ON "chatbot_conversations" USING btree ("user_id") WHERE "chatbot_conversations"."status" <> 'CLOSED';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chatbot_conversations_status_idx" ON "chatbot_conversations" USING btree ("status","last_message_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chatbot_embeddings_hnsw_idx" ON "chatbot_embeddings" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chatbot_embeddings_tsv_idx" ON "chatbot_embeddings" USING gin ("content_tsv");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chatbot_messages_conv_idx" ON "chatbot_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pose_garment_configs_pose_asset_id_idx" ON "pose_garment_configs" USING btree ("pose_asset_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pose_garment_configs_subcategory_id_idx" ON "pose_garment_configs" USING btree ("subcategory_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_inputs" ADD CONSTRAINT "job_inputs_pose_id_model_pose_assets_id_fk" FOREIGN KEY ("pose_id") REFERENCES "public"."model_pose_assets"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_inputs" ADD CONSTRAINT "job_inputs_garment_type_id_garment_subcategories_id_fk" FOREIGN KEY ("garment_type_id") REFERENCES "public"."garment_subcategories"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "jobs" ADD CONSTRAINT "jobs_widget_client_id_widget_clients_id_fk" FOREIGN KEY ("widget_client_id") REFERENCES "public"."widget_clients"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "model_backgrounds" ADD CONSTRAINT "model_backgrounds_category_id_catalog_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."catalog_categories"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "model_pose_assets" DROP COLUMN IF EXISTS "face_side_r2_key";--> statement-breakpoint
ALTER TABLE "model_pose_assets" DROP COLUMN IF EXISTS "bg_comfy_r2_key";--> statement-breakpoint
ALTER TABLE "model_pose_assets" DROP COLUMN IF EXISTS "face_id";--> statement-breakpoint
ALTER TABLE "model_pose_assets" DROP COLUMN IF EXISTS "background_id";