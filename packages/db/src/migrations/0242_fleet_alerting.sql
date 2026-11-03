CREATE TABLE IF NOT EXISTS "fleet_alert_rules" (
	"key" text PRIMARY KEY NOT NULL,
	"severity" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"for_seconds" integer NOT NULL,
	"clear_seconds" integer NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fleet_incident_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"incident_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" uuid,
	"text" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fleet_incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_key" text NOT NULL,
	"worker_id" text NOT NULL,
	"state" text DEFAULT 'OPEN' NOT NULL,
	"severity" text NOT NULL,
	"summary" text NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acked_at" timestamp with time zone,
	"acked_by" uuid,
	"recovered_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fleet_alert_rules" ADD CONSTRAINT "fleet_alert_rules_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fleet_incident_events" ADD CONSTRAINT "fleet_incident_events_incident_id_fleet_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."fleet_incidents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fleet_incident_events" ADD CONSTRAINT "fleet_incident_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fleet_incidents" ADD CONSTRAINT "fleet_incidents_acked_by_users_id_fk" FOREIGN KEY ("acked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fleet_incident_events_incident_idx" ON "fleet_incident_events" USING btree ("incident_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fleet_incidents_one_live_idx" ON "fleet_incidents" USING btree ("rule_key","worker_id") WHERE "fleet_incidents"."state" <> 'RECOVERED';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fleet_incidents_state_opened_idx" ON "fleet_incidents" USING btree ("state","opened_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fleet_incidents_worker_opened_idx" ON "fleet_incidents" USING btree ("worker_id","opened_at");

--> statement-breakpoint
-- Default alert rules. The numbers come from FLEET_ALERT_RULES in packages/types/src/fleet-incidents.ts
-- and a test fails if they ever disagree. ON CONFLICT keeps any threshold an operator has already tuned.
INSERT INTO "fleet_alert_rules" ("key", "severity", "enabled", "for_seconds", "clear_seconds", "params") VALUES
  ('agent_silent', 'warning', true, 90, 30, '{"criticalAfterSeconds":300}'::jsonb),
  ('comfy_down_box_up', 'critical', true, 60, 30, '{}'::jsonb),
  ('box_unreachable', 'critical', true, 120, 30, '{}'::jsonb),
  ('thermal_collapse', 'warning', true, 180, 120, '{"clockRatioBelow":0.6,"tempAtLeastC":80}'::jsonb),
  ('gpu_temp_high', 'warning', true, 300, 120, '{"tempAtLeastC":88}'::jsonb),
  ('disk_high', 'warning', true, 60, 300, '{"usedPctAtLeast":90,"inodePctAtLeast":90}'::jsonb),
  ('swap_active', 'info', true, 600, 600, '{"swapUsedMibAbove":1024}'::jsonb),
  ('ram_low', 'warning', true, 300, 300, '{"availablePctBelow":10}'::jsonb),
  ('foreign_vram', 'info', true, 300, 300, '{"foreignMibAbove":4096}'::jsonb),
  ('clock_skew', 'info', true, 300, 300, '{"skewSecondsAbove":30}'::jsonb),
  ('ingest_rejected', 'warning', true, 0, 600, '{"rejectsAtLeast":10}'::jsonb)
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
-- fleet.ack lets on-call acknowledge incidents and add notes without being able to create or
-- revoke agent keys (fleet.operate, SUPER_ADMIN only). Acknowledging changes no worker state.
INSERT INTO "permissions" ("key", "description") VALUES
  ('fleet.ack', 'Acknowledge GPU fleet incidents and add notes')
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("role", "permission_id")
SELECT r.role, "id" FROM "permissions"
CROSS JOIN (VALUES ('SUPER_ADMIN'), ('ADMIN')) AS r(role)
WHERE "key" = 'fleet.ack'
ON CONFLICT ("role", "permission_id") DO NOTHING;
