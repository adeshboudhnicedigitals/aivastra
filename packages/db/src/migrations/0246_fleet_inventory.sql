CREATE TABLE IF NOT EXISTS "fleet_gpus" (
	"id" text PRIMARY KEY NOT NULL,
	"host_id" text NOT NULL,
	"model" text,
	"vram_total_mb" integer,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fleet_host_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_id" text NOT NULL,
	"note" text NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fleet_hosts" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"provider" text,
	"rented" boolean,
	"monthly_cost_usd" numeric(10, 2),
	"inventory_verified" boolean DEFAULT false NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fleet_worker_map" (
	"worker_id" text PRIMARY KEY NOT NULL,
	"host_id" text NOT NULL,
	"gpu_id" text NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fleet_gpus" ADD CONSTRAINT "fleet_gpus_host_id_fleet_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."fleet_hosts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fleet_gpus" ADD CONSTRAINT "fleet_gpus_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fleet_host_reviews" ADD CONSTRAINT "fleet_host_reviews_host_id_fleet_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."fleet_hosts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fleet_host_reviews" ADD CONSTRAINT "fleet_host_reviews_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fleet_hosts" ADD CONSTRAINT "fleet_hosts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fleet_worker_map" ADD CONSTRAINT "fleet_worker_map_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fleet_worker_map" ADD CONSTRAINT "fleet_worker_map_host_id_fleet_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."fleet_hosts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fleet_worker_map" ADD CONSTRAINT "fleet_worker_map_gpu_id_fleet_gpus_id_fk" FOREIGN KEY ("gpu_id") REFERENCES "public"."fleet_gpus"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fleet_worker_map" ADD CONSTRAINT "fleet_worker_map_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fleet_gpus_host_idx" ON "fleet_gpus" USING btree ("host_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fleet_host_reviews_host_idx" ON "fleet_host_reviews" USING btree ("host_id","reviewed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fleet_worker_map_host_idx" ON "fleet_worker_map" USING btree ("host_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fleet_worker_map_gpu_idx" ON "fleet_worker_map" USING btree ("gpu_id");