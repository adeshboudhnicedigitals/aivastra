CREATE TABLE IF NOT EXISTS "shopify_funnel_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"funnel_template_id" uuid NOT NULL,
	"mode" text DEFAULT 'manual' NOT NULL,
	"conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shopify_funnel_rules_store_id_funnel_template_id_unique" UNIQUE("store_id","funnel_template_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shopify_funnel_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"label" text NOT NULL,
	"workflow_template_id" uuid NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shopify_funnel_templates_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "shopify_product_garments" ADD COLUMN "funnel_template_id" uuid;--> statement-breakpoint
ALTER TABLE "shopify_product_garments" ADD COLUMN "funnel_assignment_source" text;--> statement-breakpoint
ALTER TABLE "shopify_product_garments" ADD COLUMN "product_type" text;--> statement-breakpoint
ALTER TABLE "shopify_product_garments" ADD COLUMN "tags" text[];--> statement-breakpoint
ALTER TABLE "shopify_product_garments" ADD COLUMN "vendor" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shopify_funnel_rules" ADD CONSTRAINT "shopify_funnel_rules_store_id_shopify_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."shopify_stores"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shopify_funnel_rules" ADD CONSTRAINT "shopify_funnel_rules_funnel_template_id_shopify_funnel_templates_id_fk" FOREIGN KEY ("funnel_template_id") REFERENCES "public"."shopify_funnel_templates"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shopify_funnel_templates" ADD CONSTRAINT "shopify_funnel_templates_workflow_template_id_workflow_templates_id_fk" FOREIGN KEY ("workflow_template_id") REFERENCES "public"."workflow_templates"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shopify_product_garments" ADD CONSTRAINT "shopify_product_garments_funnel_template_id_shopify_funnel_templates_id_fk" FOREIGN KEY ("funnel_template_id") REFERENCES "public"."shopify_funnel_templates"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
