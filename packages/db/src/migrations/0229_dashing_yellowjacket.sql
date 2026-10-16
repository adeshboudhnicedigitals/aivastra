CREATE TABLE IF NOT EXISTS "classify_service_config" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"url" text NOT NULL,
	"api_key" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
