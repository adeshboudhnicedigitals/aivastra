CREATE TABLE IF NOT EXISTS "garment_recognitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"gender" text,
	"garment_key" text NOT NULL,
	"options" jsonb NOT NULL,
	"answer" text,
	"outcome" text NOT NULL,
	"ms" integer NOT NULL,
	"worker_id" text,
	"workflow_template_id" uuid
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "garment_recognitions_created_at_idx" ON "garment_recognitions" USING btree ("created_at" desc);