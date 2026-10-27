CREATE TABLE IF NOT EXISTS "dispatcher_job_control" (
	"job_id" uuid PRIMARY KEY NOT NULL,
	"owner_session" uuid,
	"generation" bigint DEFAULT 0 NOT NULL,
	"lease_until" timestamp with time zone,
	"owner_retired" boolean DEFAULT false NOT NULL,
	"active_attempt_id" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "execution_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid,
	"request_id" uuid,
	"attempt_no" integer NOT NULL,
	"phase" text NOT NULL,
	"client_id" text NOT NULL,
	"state" text NOT NULL,
	"worker_id" text,
	"worker_url" text,
	"prompt_id" text,
	"uncertain_deadline" timestamp with time zone,
	"contract" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "execution_attempts_client_id_unique" UNIQUE("client_id"),
	CONSTRAINT "execution_attempts_one_parent" CHECK (num_nonnulls("execution_attempts"."job_id", "execution_attempts"."request_id") = 1),
	CONSTRAINT "execution_attempts_positive_number" CHECK ("execution_attempts"."attempt_no" > 0),
	CONSTRAINT "execution_attempts_phase" CHECK ("execution_attempts"."phase" IN ('main', 'mannequin', 'classify')),
	CONSTRAINT "execution_attempts_state" CHECK ("execution_attempts"."state" IN ('PREPARING', 'SUBMITTING', 'ACCEPTED', 'OUTPUT_READY', 'SUCCEEDED', 'FAILED', 'UNKNOWN_RETRIED')),
	CONSTRAINT "execution_attempts_receipt" CHECK ("execution_attempts"."state" NOT IN ('ACCEPTED', 'OUTPUT_READY', 'SUCCEEDED') OR "execution_attempts"."prompt_id" IS NOT NULL),
	CONSTRAINT "execution_attempts_contract_object" CHECK (jsonb_typeof("execution_attempts"."contract") = 'object')
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dispatcher_job_control" ADD CONSTRAINT "dispatcher_job_control_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dispatcher_job_control" ADD CONSTRAINT "dispatcher_job_control_active_attempt_id_execution_attempts_id_fk" FOREIGN KEY ("active_attempt_id") REFERENCES "public"."execution_attempts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "execution_attempts" ADD CONSTRAINT "execution_attempts_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dispatcher_job_control_recovery" ON "dispatcher_job_control" USING btree ("owner_retired","lease_until");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "execution_attempts_job_sequence_phase" ON "execution_attempts" USING btree ("job_id","attempt_no","phase");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "execution_attempts_request_sequence_phase" ON "execution_attempts" USING btree ("request_id","attempt_no","phase");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "execution_attempts_unresolved_worker" ON "execution_attempts" USING btree ("worker_id") WHERE "execution_attempts"."resolved_at" IS NULL AND "execution_attempts"."job_id" IS NOT NULL;