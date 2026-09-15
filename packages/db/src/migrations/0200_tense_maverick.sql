DROP INDEX IF EXISTS "shopify_funnel_templates_single_default_idx";--> statement-breakpoint
ALTER TABLE "shopify_funnel_templates" DROP COLUMN IF EXISTS "is_default";