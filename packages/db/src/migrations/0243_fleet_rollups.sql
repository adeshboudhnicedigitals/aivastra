CREATE TABLE IF NOT EXISTS "fleet_gpu_rollups" (
	"worker_id" text NOT NULL,
	"gpu_index" smallint NOT NULL,
	"bucket" timestamp with time zone NOT NULL,
	"n" integer NOT NULL,
	"temp_avg" real,
	"temp_max" real,
	"sm_clock_avg" real,
	"sm_clock_min" integer,
	"power_avg" real,
	"power_max" real,
	"util_avg" real,
	"vram_used_max" integer,
	"vram_total_max" integer,
	CONSTRAINT "fleet_gpu_rollups_worker_id_gpu_index_bucket_pk" PRIMARY KEY("worker_id","gpu_index","bucket")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fleet_host_rollups" (
	"worker_id" text NOT NULL,
	"bucket" timestamp with time zone NOT NULL,
	"n" integer NOT NULL,
	"load1_max" real,
	"ram_avail_min" integer,
	"swap_used_max" integer,
	"mem_psi_max" real,
	CONSTRAINT "fleet_host_rollups_worker_id_bucket_pk" PRIMARY KEY("worker_id","bucket")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fleet_gpu_rollups_time_idx" ON "fleet_gpu_rollups" USING btree ("bucket");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fleet_host_rollups_time_idx" ON "fleet_host_rollups" USING btree ("bucket");