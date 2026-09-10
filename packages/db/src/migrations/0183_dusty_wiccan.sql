CREATE TABLE IF NOT EXISTS "merchant_widget_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"client_id" text,
	"product_id" bigint,
	"type" text NOT NULL,
	"device" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "merchant_widget_events" ADD CONSTRAINT "merchant_widget_events_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "merchant_widget_events_merchant_time_idx" ON "merchant_widget_events" USING btree ("merchant_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "merchant_widget_events_merchant_type_time_idx" ON "merchant_widget_events" USING btree ("merchant_id","type","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "merchant_widget_events_merchant_product_time_idx" ON "merchant_widget_events" USING btree ("merchant_id","product_id","created_at");