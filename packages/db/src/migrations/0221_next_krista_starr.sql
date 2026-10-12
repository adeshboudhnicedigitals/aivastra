CREATE TABLE IF NOT EXISTS "refund_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"credits" integer NOT NULL,
	"reason_code" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"admin_note" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refund_requests_job_id_unique" UNIQUE("job_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "refund_requests_status_created_idx" ON "refund_requests" USING btree ("status","created_at");