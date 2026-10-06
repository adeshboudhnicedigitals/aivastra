ALTER TABLE "fabric_garment_types" ADD COLUMN "garment_type_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fabric_garment_types" ADD CONSTRAINT "fabric_garment_types_garment_type_id_garment_subcategories_id_fk" FOREIGN KEY ("garment_type_id") REFERENCES "public"."garment_subcategories"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
