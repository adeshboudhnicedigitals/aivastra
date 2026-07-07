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
	CONSTRAINT "shopify_stores_shopify_shop_id_unique" UNIQUE("shopify_shop_id"),
	CONSTRAINT "shopify_stores_widget_client_id_widget_clients_id_fk" FOREIGN KEY ("widget_client_id") REFERENCES "widget_clients"("id") ON DELETE cascade,
	CONSTRAINT "shopify_stores_shopify_plan_id_shopify_plans_id_fk" FOREIGN KEY ("shopify_plan_id") REFERENCES "shopify_plans"("id") ON DELETE no action
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
	CONSTRAINT "shopify_product_garments_store_id_shopify_product_id_shopify_variant_id_unique" UNIQUE("store_id","shopify_product_id","shopify_variant_id"),
	CONSTRAINT "shopify_product_garments_store_id_shopify_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "shopify_stores"("id") ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE "widget_clients" ADD COLUMN IF NOT EXISTS "client_type" text DEFAULT 'merchant' NOT NULL;
