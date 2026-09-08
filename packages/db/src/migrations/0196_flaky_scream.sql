ALTER TABLE "shopify_stores" ADD COLUMN "support_user_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shopify_stores" ADD CONSTRAINT "shopify_stores_support_user_id_users_id_fk" FOREIGN KEY ("support_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
