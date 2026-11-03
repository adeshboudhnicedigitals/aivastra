ALTER TABLE "execution_attempts" DROP CONSTRAINT "execution_attempts_phase";--> statement-breakpoint
ALTER TABLE "garment_subcategories" ADD COLUMN "requires_garment_extract_step" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "garment_subcategories" ADD COLUMN "garment_extract_workflow_template_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "garment_subcategories" ADD CONSTRAINT "garment_subcategories_garment_extract_workflow_template_id_workflow_templates_id_fk" FOREIGN KEY ("garment_extract_workflow_template_id") REFERENCES "public"."workflow_templates"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "execution_attempts" ADD CONSTRAINT "execution_attempts_phase" CHECK ("execution_attempts"."phase" IN ('main', 'mannequin', 'garment_extract', 'classify'));