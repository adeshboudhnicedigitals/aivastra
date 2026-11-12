ALTER TABLE "admin_users" ADD COLUMN "totp_secret_enc" text;--> statement-breakpoint
ALTER TABLE "admin_users" ADD COLUMN "totp_enabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "admin_users" ADD COLUMN "totp_last_step" bigint;--> statement-breakpoint
ALTER TABLE "admin_users" ADD COLUMN "totp_recovery_hashes" jsonb DEFAULT '[]'::jsonb NOT NULL;