ALTER TABLE "shopify_credit_purchases" ADD COLUMN "payment_status_source" text DEFAULT 'AUTO' NOT NULL;--> statement-breakpoint
ALTER TABLE "shopify_credit_purchases" ADD COLUMN "payment_note" text;--> statement-breakpoint
ALTER TABLE "shopify_credit_purchases" ADD COLUMN "payment_flagged_by" uuid;--> statement-breakpoint
ALTER TABLE "shopify_credit_purchases" ADD COLUMN "payment_flagged_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shopify_credit_purchases" ADD CONSTRAINT "shopify_credit_purchases_payment_flagged_by_users_id_fk" FOREIGN KEY ("payment_flagged_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shopify_credit_purchases_verify_payment_idx" ON "shopify_credit_purchases" USING btree ("next_payment_check_at") WHERE "shopify_credit_purchases"."payment_status" IN ('UNVERIFIED','NOT_RECEIVED') AND "shopify_credit_purchases"."payment_status_source" = 'AUTO';