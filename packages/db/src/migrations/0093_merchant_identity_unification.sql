ALTER TABLE "widget_clients" DROP CONSTRAINT "widget_clients_email_key";--> statement-breakpoint
ALTER TABLE "widget_clients" DROP CONSTRAINT "widget_clients_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "widget_clients" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "widget_clients" DROP COLUMN IF EXISTS "email";--> statement-breakpoint
ALTER TABLE "widget_clients" DROP COLUMN IF EXISTS "password_hash";--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "widget_clients" ADD CONSTRAINT "widget_clients_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "widget_clients" ADD CONSTRAINT "widget_clients_user_id_unique" UNIQUE("user_id");
