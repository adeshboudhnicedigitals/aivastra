CREATE TABLE IF NOT EXISTS "role_nav_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role" text NOT NULL,
	"nav_key" text NOT NULL,
	"visible" boolean NOT NULL,
	CONSTRAINT "role_nav_overrides_role_nav_key_unique" UNIQUE("role","nav_key")
);
