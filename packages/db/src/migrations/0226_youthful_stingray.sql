CREATE TABLE IF NOT EXISTS "messaging_runs" (
	"catalogue_id" uuid PRIMARY KEY NOT NULL,
	"messaging_account_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"job_ids" uuid[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "messaging_runs" ADD CONSTRAINT "messaging_runs_messaging_account_id_messaging_accounts_id_fk" FOREIGN KEY ("messaging_account_id") REFERENCES "public"."messaging_accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "messaging_runs" ADD CONSTRAINT "messaging_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messaging_runs_account_created_idx" ON "messaging_runs" USING btree ("messaging_account_id","created_at");