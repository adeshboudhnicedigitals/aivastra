ALTER TABLE "job_inputs" ADD COLUMN "fourth_garment_key" text;--> statement-breakpoint
ALTER TABLE "garment_subcategories" ADD COLUMN "allows_fourth_upload" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "garment_subcategories" ADD COLUMN "fourth_upload_label" text;--> statement-breakpoint
ALTER TABLE "workflow_template_archives" ADD COLUMN "fourth_node_id" text;--> statement-breakpoint
ALTER TABLE "workflow_templates" ADD COLUMN "fourth_node_id" text;