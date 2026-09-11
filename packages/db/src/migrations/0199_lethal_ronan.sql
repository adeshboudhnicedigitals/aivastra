ALTER TABLE "workflow_template_archives" ADD COLUMN "sam_segmentation_prompt_node" text;--> statement-breakpoint
ALTER TABLE "workflow_template_archives" ADD COLUMN "default_sam_segmentation_prompt" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_templates" ADD COLUMN "sam_segmentation_prompt_node" text;--> statement-breakpoint
ALTER TABLE "workflow_templates" ADD COLUMN "default_sam_segmentation_prompt" text DEFAULT '' NOT NULL;