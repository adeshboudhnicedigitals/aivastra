CREATE INDEX IF NOT EXISTS "jobs_branch_idx" ON "jobs" USING btree ("branch_id") WHERE "jobs"."branch_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_device_idx" ON "jobs" USING btree ("device_id") WHERE "jobs"."device_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_session_idx" ON "jobs" USING btree ("session_id") WHERE "jobs"."session_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_staff_idx" ON "jobs" USING btree ("staff_id") WHERE "jobs"."staff_id" is not null;