CREATE TABLE IF NOT EXISTS "unlimited_plan_charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unlimited_plan_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"price_paise" integer NOT NULL,
	"charge_type" text NOT NULL,
	"charged_by" uuid NOT NULL,
	"charged_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "unlimited_plans" ADD COLUMN "price_paise" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "unlimited_plans" ADD COLUMN "queue_stream" text DEFAULT 'normal' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "unlimited_plan_charges" ADD CONSTRAINT "unlimited_plan_charges_unlimited_plan_id_unlimited_plans_id_fk" FOREIGN KEY ("unlimited_plan_id") REFERENCES "public"."unlimited_plans"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "unlimited_plan_charges" ADD CONSTRAINT "unlimited_plan_charges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "unlimited_plan_charges" ADD CONSTRAINT "unlimited_plan_charges_charged_by_users_id_fk" FOREIGN KEY ("charged_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
