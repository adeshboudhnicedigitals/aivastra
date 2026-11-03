ALTER TABLE "fleet_gpu_rollups" ADD COLUMN IF NOT EXISTS "hw_thermal_slowdown_us_max" bigint;--> statement-breakpoint
ALTER TABLE "fleet_gpu_rollups" ADD COLUMN IF NOT EXISTS "sw_thermal_slowdown_us_max" bigint;--> statement-breakpoint
ALTER TABLE "fleet_gpu_rollups" ADD COLUMN IF NOT EXISTS "sw_power_cap_us_max" bigint;--> statement-breakpoint
ALTER TABLE "fleet_gpu_samples" ADD COLUMN IF NOT EXISTS "hw_thermal_slowdown_us" bigint;--> statement-breakpoint
ALTER TABLE "fleet_gpu_samples" ADD COLUMN IF NOT EXISTS "sw_thermal_slowdown_us" bigint;--> statement-breakpoint
ALTER TABLE "fleet_gpu_samples" ADD COLUMN IF NOT EXISTS "sw_power_cap_us" bigint;
--> statement-breakpoint
-- New alert rule. Numbers mirror FLEET_ALERT_RULES.thermal_slowdown in packages/types/src/fleet-incidents.ts.
INSERT INTO "fleet_alert_rules" ("key", "severity", "enabled", "for_seconds", "clear_seconds", "params") VALUES
  ('thermal_slowdown', 'warning', true, 60, 600, '{"slowedSecondsAbove":30}'::jsonb)
ON CONFLICT ("key") DO NOTHING;
