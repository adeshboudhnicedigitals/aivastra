ALTER TABLE "job_inputs" ADD COLUMN "accessory_catalog_ids" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_template_archives" ADD COLUMN "accessory_node_id" text;--> statement-breakpoint
ALTER TABLE "workflow_templates" ADD COLUMN "accessory_node_id" text;