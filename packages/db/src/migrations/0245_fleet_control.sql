CREATE TABLE IF NOT EXISTS "fleet_commands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"worker_id" text NOT NULL,
	"kind" text NOT NULL,
	"reason" text NOT NULL,
	"state" text DEFAULT 'PENDING' NOT NULL,
	"requested_by" uuid,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"result" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fleet_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fleet_commands" ADD CONSTRAINT "fleet_commands_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fleet_commands" ADD CONSTRAINT "fleet_commands_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fleet_settings" ADD CONSTRAINT "fleet_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fleet_commands_one_live_idx" ON "fleet_commands" USING btree ("worker_id") WHERE "fleet_commands"."state" IN ('PENDING', 'RUNNING');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fleet_commands_worker_time_idx" ON "fleet_commands" USING btree ("worker_id","requested_at");