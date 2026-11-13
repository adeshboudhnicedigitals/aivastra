CREATE TABLE IF NOT EXISTS "merchant_crm_settings" (
	"merchant_id" uuid PRIMARY KEY NOT NULL,
	"identify_at" text DEFAULT 'end' NOT NULL,
	"photo_retention_days" integer,
	"profile_retention_days" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "merchant_whatsapp_channels" (
	"merchant_id" uuid PRIMARY KEY NOT NULL,
	"waba_id" text NOT NULL,
	"phone_number_id" text NOT NULL,
	"display_number" text NOT NULL,
	"access_token_enc" text NOT NULL,
	"app_secret_enc" text NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"connected_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shopper_consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shopper_id" uuid NOT NULL,
	"merchant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"granted" boolean NOT NULL,
	"version" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shoppers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"phone_enc" text,
	"phone_hash" text,
	"display_name" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "instore_sessions" ADD COLUMN "shopper_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "merchant_crm_settings" ADD CONSTRAINT "merchant_crm_settings_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "merchant_crm_settings" ADD CONSTRAINT "merchant_crm_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "merchant_whatsapp_channels" ADD CONSTRAINT "merchant_whatsapp_channels_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "merchant_whatsapp_channels" ADD CONSTRAINT "merchant_whatsapp_channels_connected_by_users_id_fk" FOREIGN KEY ("connected_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shopper_consents" ADD CONSTRAINT "shopper_consents_shopper_id_shoppers_id_fk" FOREIGN KEY ("shopper_id") REFERENCES "public"."shoppers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shopper_consents" ADD CONSTRAINT "shopper_consents_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shoppers" ADD CONSTRAINT "shoppers_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "merchant_whatsapp_channels_phone_number_id_uq" ON "merchant_whatsapp_channels" USING btree ("phone_number_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shopper_consents_shopper_idx" ON "shopper_consents" USING btree ("shopper_id","kind","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "shoppers_merchant_phone_hash_uq" ON "shoppers" USING btree ("merchant_id","phone_hash") WHERE "shoppers"."phone_hash" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shoppers_live_last_seen_idx" ON "shoppers" USING btree ("last_seen_at") WHERE "shoppers"."deleted_at" is null;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "instore_sessions" ADD CONSTRAINT "instore_sessions_shopper_id_shoppers_id_fk" FOREIGN KEY ("shopper_id") REFERENCES "public"."shoppers"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "instore_sessions_shopper_idx" ON "instore_sessions" USING btree ("shopper_id") WHERE "instore_sessions"."shopper_id" is not null;