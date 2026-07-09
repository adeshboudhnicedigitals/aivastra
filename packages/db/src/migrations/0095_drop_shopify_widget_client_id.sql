ALTER TABLE "shopify_stores" DROP CONSTRAINT "shopify_stores_widget_client_id_unique";--> statement-breakpoint
ALTER TABLE "shopify_stores" DROP CONSTRAINT "shopify_stores_widget_client_id_widget_clients_id_fk";
--> statement-breakpoint
ALTER TABLE "shopify_stores" DROP COLUMN IF EXISTS "widget_client_id";