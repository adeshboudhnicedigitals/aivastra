ALTER TABLE "shopify_shoppers" ADD COLUMN "redaction_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shopify_stores" ADD COLUMN "redaction_requested_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shopify_shoppers_redaction_pending_idx" ON "shopify_shoppers" ("redaction_requested_at") WHERE "redaction_requested_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shopify_stores_redaction_pending_idx" ON "shopify_stores" ("redaction_requested_at") WHERE "redaction_requested_at" IS NOT NULL;
