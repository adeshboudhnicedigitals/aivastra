CREATE TABLE IF NOT EXISTS "body_type_faces" (
	"body_type_id" uuid NOT NULL,
	"face_id" uuid NOT NULL,
	CONSTRAINT "body_type_faces_body_type_id_face_id_pk" PRIMARY KEY("body_type_id","face_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "body_type_poses" (
	"body_type_id" uuid NOT NULL,
	"pose_asset_id" uuid NOT NULL,
	CONSTRAINT "body_type_poses_body_type_id_pose_asset_id_pk" PRIMARY KEY("body_type_id","pose_asset_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "body_type_subcategories" (
	"body_type_id" uuid NOT NULL,
	"subcategory_id" uuid NOT NULL,
	CONSTRAINT "body_type_subcategories_body_type_id_subcategory_id_pk" PRIMARY KEY("body_type_id","subcategory_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "body_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gender_slug" text NOT NULL,
	"label" text NOT NULL,
	"thumbnail_key" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "body_type_faces" ADD CONSTRAINT "body_type_faces_body_type_id_body_types_id_fk" FOREIGN KEY ("body_type_id") REFERENCES "public"."body_types"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "body_type_faces" ADD CONSTRAINT "body_type_faces_face_id_model_faces_id_fk" FOREIGN KEY ("face_id") REFERENCES "public"."model_faces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "body_type_poses" ADD CONSTRAINT "body_type_poses_body_type_id_body_types_id_fk" FOREIGN KEY ("body_type_id") REFERENCES "public"."body_types"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "body_type_poses" ADD CONSTRAINT "body_type_poses_pose_asset_id_model_pose_assets_id_fk" FOREIGN KEY ("pose_asset_id") REFERENCES "public"."model_pose_assets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "body_type_subcategories" ADD CONSTRAINT "body_type_subcategories_body_type_id_body_types_id_fk" FOREIGN KEY ("body_type_id") REFERENCES "public"."body_types"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "body_type_subcategories" ADD CONSTRAINT "body_type_subcategories_subcategory_id_garment_subcategories_id_fk" FOREIGN KEY ("subcategory_id") REFERENCES "public"."garment_subcategories"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
INSERT INTO "permissions" ("key", "description") VALUES
  ('body_types.write', 'Create and update body types and their mappings'),
  ('body_types.delete', 'Delete body types')
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("role", "permission_id")
SELECT 'SUPER_ADMIN', "id" FROM "permissions" WHERE "key" IN ('body_types.write', 'body_types.delete')
ON CONFLICT ("role", "permission_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("role", "permission_id")
SELECT 'ADMIN', "id" FROM "permissions" WHERE "key" = 'body_types.write'
ON CONFLICT ("role", "permission_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("role", "permission_id")
SELECT 'MODERATOR', "id" FROM "permissions" WHERE "key" IN ('body_types.write', 'body_types.delete')
ON CONFLICT ("role", "permission_id") DO NOTHING;
