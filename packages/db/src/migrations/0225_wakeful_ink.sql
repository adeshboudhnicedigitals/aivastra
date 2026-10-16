CREATE TABLE IF NOT EXISTS "messaging_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel" text NOT NULL,
	"external_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"opted_in_at" timestamp with time zone DEFAULT now() NOT NULL,
	"opted_out_at" timestamp with time zone,
	"last_inbound_at" timestamp with time zone,
	"linked_via" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "messaging_accounts" ADD CONSTRAINT "messaging_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "messaging_accounts_channel_external_id_uniq" ON "messaging_accounts" USING btree ("channel","external_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messaging_accounts_user_id_idx" ON "messaging_accounts" USING btree ("user_id");