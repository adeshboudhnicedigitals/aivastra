CREATE TABLE IF NOT EXISTS "shopify_attributed_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"shopify_order_id" bigint NOT NULL,
	"shopper_id" uuid,
	"currency" text NOT NULL,
	"revenue" numeric(14, 2) NOT NULL,
	"ordered_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shopify_attributed_orders_store_id_shopify_order_id_unique" UNIQUE("store_id","shopify_order_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shopify_attributed_orders" ADD CONSTRAINT "shopify_attributed_orders_store_id_shopify_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."shopify_stores"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shopify_attributed_orders" ADD CONSTRAINT "shopify_attributed_orders_shopper_id_shopify_shoppers_id_fk" FOREIGN KEY ("shopper_id") REFERENCES "public"."shopify_shoppers"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shopify_attributed_orders_store_time_idx" ON "shopify_attributed_orders" USING btree ("store_id","ordered_at");