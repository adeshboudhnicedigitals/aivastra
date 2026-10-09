ALTER TABLE "shopify_credit_purchases" ADD COLUMN "payment_status" text DEFAULT 'NOT_REQUIRED' NOT NULL;--> statement-breakpoint
ALTER TABLE "shopify_credit_purchases" ADD COLUMN "paid_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shopify_credit_purchases" ADD COLUMN "next_payment_check_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shopify_credit_purchases_awaiting_payment_idx" ON "shopify_credit_purchases" USING btree ("next_payment_check_at") WHERE "shopify_credit_purchases"."payment_status" = 'AWAITING';