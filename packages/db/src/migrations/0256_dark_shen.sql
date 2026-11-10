CREATE TABLE IF NOT EXISTS "instore_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"staff_id" uuid,
	"mode" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "merchant_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"name" text NOT NULL,
	"device_token_hash" text,
	"pairing_code_hash" text,
	"pairing_expires_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_devices_device_token_hash_unique" UNIQUE("device_token_hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "session_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"catalog_item_id" uuid NOT NULL,
	"job_id" uuid,
	"action" text NOT NULL,
	"staff_id" uuid,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "branch_id" uuid;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "device_id" uuid;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "session_id" uuid;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "staff_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "instore_sessions" ADD CONSTRAINT "instore_sessions_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "instore_sessions" ADD CONSTRAINT "instore_sessions_branch_id_merchant_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."merchant_branches"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "instore_sessions" ADD CONSTRAINT "instore_sessions_device_id_merchant_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."merchant_devices"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "instore_sessions" ADD CONSTRAINT "instore_sessions_staff_id_merchant_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."merchant_staff"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "merchant_devices" ADD CONSTRAINT "merchant_devices_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "merchant_devices" ADD CONSTRAINT "merchant_devices_branch_id_merchant_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."merchant_branches"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "session_items" ADD CONSTRAINT "session_items_session_id_instore_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."instore_sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "session_items" ADD CONSTRAINT "session_items_staff_id_merchant_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."merchant_staff"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "instore_sessions_device_idx" ON "instore_sessions" USING btree ("device_id","ended_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "instore_sessions_merchant_idx" ON "instore_sessions" USING btree ("merchant_id","started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "merchant_devices_branch_idx" ON "merchant_devices" USING btree ("branch_id","is_active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "merchant_devices_merchant_idx" ON "merchant_devices" USING btree ("merchant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "session_items_session_idx" ON "session_items" USING btree ("session_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "jobs" ADD CONSTRAINT "jobs_branch_id_merchant_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."merchant_branches"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "jobs" ADD CONSTRAINT "jobs_device_id_merchant_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."merchant_devices"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "jobs" ADD CONSTRAINT "jobs_session_id_instore_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."instore_sessions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "jobs" ADD CONSTRAINT "jobs_staff_id_merchant_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."merchant_staff"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
