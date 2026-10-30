CREATE TABLE IF NOT EXISTS "blouse_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gender_slug" text,
	"label" text NOT NULL,
	"thumbnail_key" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "blouse_category_subcategories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"subcategory_id" uuid NOT NULL,
	CONSTRAINT "blouse_category_subcategories_category_subcategory_unique" UNIQUE("category_id","subcategory_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "blouse_poses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"label" text NOT NULL,
	"r2_key" text NOT NULL,
	"thumbnail_key" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job_inputs" ADD COLUMN "blouse_pose_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "blouse_category_subcategories" ADD CONSTRAINT "blouse_category_subcategories_category_id_blouse_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."blouse_categories"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "blouse_category_subcategories" ADD CONSTRAINT "blouse_category_subcategories_subcategory_id_garment_subcategories_id_fk" FOREIGN KEY ("subcategory_id") REFERENCES "public"."garment_subcategories"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "blouse_poses" ADD CONSTRAINT "blouse_poses_category_id_blouse_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."blouse_categories"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "blouse_category_subcategories_subcategory_id_idx" ON "blouse_category_subcategories" USING btree ("subcategory_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "blouse_poses_category_id_idx" ON "blouse_poses" USING btree ("category_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_inputs" ADD CONSTRAINT "job_inputs_blouse_pose_id_blouse_poses_id_fk" FOREIGN KEY ("blouse_pose_id") REFERENCES "public"."blouse_poses"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
