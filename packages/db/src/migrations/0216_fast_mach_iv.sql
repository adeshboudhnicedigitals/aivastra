CREATE TABLE IF NOT EXISTS "model_face_subcategories" (
	"face_id" uuid NOT NULL,
	"subcategory_id" uuid NOT NULL,
	CONSTRAINT "model_face_subcategories_face_id_subcategory_id_pk" PRIMARY KEY("face_id","subcategory_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "model_face_subcategories" ADD CONSTRAINT "model_face_subcategories_face_id_model_faces_id_fk" FOREIGN KEY ("face_id") REFERENCES "public"."model_faces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "model_face_subcategories" ADD CONSTRAINT "model_face_subcategories_subcategory_id_garment_subcategories_id_fk" FOREIGN KEY ("subcategory_id") REFERENCES "public"."garment_subcategories"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
