CREATE TABLE IF NOT EXISTS "workflow_comparisons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_job_id" uuid NOT NULL,
	"general_job_id" uuid,
	"template_id" uuid NOT NULL,
	"template_version" integer NOT NULL,
	"status" text NOT NULL,
	"unsupported_reason" text,
	"source_source" text,
	"source_template_id" uuid,
	"person_key" text,
	"garment_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_comparisons_version_positive" CHECK ("workflow_comparisons"."template_version" > 0),
	CONSTRAINT "workflow_comparisons_status_valid" CHECK ("workflow_comparisons"."status" IN ('COLLECTED', 'QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'UNSUPPORTED', 'EXPIRED', 'CANCELLED'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_comparisons" ADD CONSTRAINT "workflow_comparisons_source_job_id_jobs_id_fk" FOREIGN KEY ("source_job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_comparisons" ADD CONSTRAINT "workflow_comparisons_general_job_id_jobs_id_fk" FOREIGN KEY ("general_job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_comparisons" ADD CONSTRAINT "workflow_comparisons_template_id_workflow_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."workflow_templates"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workflow_comparisons_source_template_version_idx" ON "workflow_comparisons" USING btree ("source_job_id","template_id","template_version");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_comparisons_status_created_idx" ON "workflow_comparisons" USING btree ("status","created_at");