CREATE TABLE IF NOT EXISTS "fabric_garment_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"gender_slug" text,
	"label" text NOT NULL,
	"thumbnail_key" text,
	"prompt" text NOT NULL,
	"negative_prompt" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fabric_garment_types_slug_gender_slug_unique" UNIQUE("slug","gender_slug")
);
--> statement-breakpoint
INSERT INTO "permissions" ("key", "description") VALUES
  ('fabricGarmentTypes.read', 'View Fabric-to-Garment garment-type presets'),
  ('fabricGarmentTypes.write', 'Create and update Fabric-to-Garment garment-type presets'),
  ('fabricGarmentTypes.delete', 'Delete Fabric-to-Garment garment-type presets')
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("role", "permission_id")
SELECT r.role, p."id"
FROM "permissions" p
CROSS JOIN (VALUES ('SUPER_ADMIN'), ('MODERATOR'), ('ADMIN')) AS r(role)
WHERE p."key" IN ('fabricGarmentTypes.read', 'fabricGarmentTypes.write')
ON CONFLICT ("role", "permission_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("role", "permission_id")
SELECT r.role, p."id"
FROM "permissions" p
CROSS JOIN (VALUES ('SUPER_ADMIN'), ('MODERATOR')) AS r(role)
WHERE p."key" = 'fabricGarmentTypes.delete'
ON CONFLICT ("role", "permission_id") DO NOTHING;
