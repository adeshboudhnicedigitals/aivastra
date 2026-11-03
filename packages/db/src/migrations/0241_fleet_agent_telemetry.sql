CREATE TABLE IF NOT EXISTS "fleet_agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"worker_id" text NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"last_seen_at" timestamp with time zone,
	"agent_version" text,
	"boot_id" text,
	"clock_skew_ms" integer,
	CONSTRAINT "fleet_agents_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fleet_gpu_samples" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"worker_id" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"gpu_index" smallint NOT NULL,
	"name" text,
	"temp_c" real,
	"mem_temp_c" real,
	"fan_pct" real,
	"pstate" text,
	"sm_clock_mhz" integer,
	"sm_clock_max_mhz" integer,
	"mem_clock_mhz" integer,
	"power_w" real,
	"power_limit_w" real,
	"util_gpu_pct" real,
	"util_mem_pct" real,
	"vram_used_mib" integer,
	"vram_total_mib" integer,
	"throttle_reasons" text,
	"ecc_uncorrected" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fleet_host_samples" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"worker_id" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"boot_id" text NOT NULL,
	"seq" bigint NOT NULL,
	"agent_version" text NOT NULL,
	"clock_skew_ms" integer NOT NULL,
	"cpu_count" smallint,
	"load1" real,
	"load5" real,
	"load15" real,
	"ram_total_mib" integer,
	"ram_avail_mib" integer,
	"swap_total_mib" integer,
	"swap_used_mib" integer,
	"mem_psi_some10" real,
	"uptime_sec" bigint,
	"ntp_synced" boolean,
	"disks" jsonb NOT NULL,
	"services" jsonb NOT NULL,
	"comfy" jsonb NOT NULL,
	"compute_apps" jsonb NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fleet_agents" ADD CONSTRAINT "fleet_agents_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fleet_agents" ADD CONSTRAINT "fleet_agents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fleet_agents" ADD CONSTRAINT "fleet_agents_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fleet_agents_worker_idx" ON "fleet_agents" USING btree ("worker_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fleet_gpu_samples_worker_gpu_time_idx" ON "fleet_gpu_samples" USING btree ("worker_id","gpu_index","observed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fleet_gpu_samples_time_idx" ON "fleet_gpu_samples" USING btree ("observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fleet_host_samples_sample_uniq" ON "fleet_host_samples" USING btree ("worker_id","boot_id","seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fleet_host_samples_worker_time_idx" ON "fleet_host_samples" USING btree ("worker_id","observed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fleet_host_samples_time_idx" ON "fleet_host_samples" USING btree ("observed_at");