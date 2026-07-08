ALTER TABLE "shopify_product_garments" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "shopify_product_garments" ADD COLUMN "enabled" boolean DEFAULT false NOT NULL;