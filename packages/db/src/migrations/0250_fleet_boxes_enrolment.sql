CREATE TABLE IF NOT EXISTS "fleet_enroll_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"token_hash" text NOT NULL,
	"token_prefix" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "fleet_enroll_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "fleet_agents" DROP CONSTRAINT "fleet_agents_worker_id_workers_id_fk";
--> statement-breakpoint
-- Agent keys now belong to a box (fleet_hosts), not an admin worker. A key bound to a worker id has
-- no box to point at and can never authenticate again under the new model, so it is removed here;
-- otherwise the foreign key added below fails and blocks the deploy. Production held 0 such rows
-- when this was written (2026-11-03); staging/local may hold test keys.
DELETE FROM "fleet_agents" WHERE "worker_id" NOT IN (SELECT "id" FROM "fleet_hosts");
--> statement-breakpoint
ALTER TABLE "fleet_hosts" ADD COLUMN "worker_id" text;--> statement-breakpoint
ALTER TABLE "fleet_hosts" ADD COLUMN "hardware" jsonb;--> statement-breakpoint
ALTER TABLE "fleet_hosts" ADD COLUMN "hardware_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fleet_enroll_tokens" ADD CONSTRAINT "fleet_enroll_tokens_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fleet_enroll_tokens" ADD CONSTRAINT "fleet_enroll_tokens_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fleet_agents" ADD CONSTRAINT "fleet_agents_worker_id_fleet_hosts_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."fleet_hosts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fleet_hosts" ADD CONSTRAINT "fleet_hosts_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
