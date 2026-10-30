CREATE TABLE IF NOT EXISTS "model_background_subcategories" (
	"background_id" uuid NOT NULL,
	"subcategory_id" uuid NOT NULL,
	CONSTRAINT "model_background_subcategories_background_id_subcategory_id_pk" PRIMARY KEY("background_id","subcategory_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "model_background_subcategories" ADD CONSTRAINT "model_background_subcategories_background_id_model_backgrounds_id_fk" FOREIGN KEY ("background_id") REFERENCES "public"."model_backgrounds"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "model_background_subcategories" ADD CONSTRAINT "model_background_subcategories_subcategory_id_garment_subcategories_id_fk" FOREIGN KEY ("subcategory_id") REFERENCES "public"."garment_subcategories"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
