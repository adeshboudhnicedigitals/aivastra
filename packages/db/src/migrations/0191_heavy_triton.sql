CREATE TABLE IF NOT EXISTS "unlimited_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"note" text,
	"granted_by" uuid NOT NULL,
	"revoked_by" uuid,
	"revoked_at" timestamp with time zone,
	"last_reminder_stage" text DEFAULT 'none' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "unlimited_plans" ADD CONSTRAINT "unlimited_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "unlimited_plans" ADD CONSTRAINT "unlimited_plans_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "unlimited_plans" ADD CONSTRAINT "unlimited_plans_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- One active grant per user at a time. History isn't kept (a re-grant while
-- active overwrites the row in place) — see unlimited_plans schema comment.
CREATE UNIQUE INDEX IF NOT EXISTS "unlimited_plans_one_active_per_user"
  ON "unlimited_plans" ("user_id") WHERE "status" = 'active';
