CREATE TABLE IF NOT EXISTS "merchant_branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"city" text,
	"address" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "merchant_staff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_staff_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN "staff_limit_per_branch" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN "device_quota_per_month" integer;--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN "store_url" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "merchant_branches" ADD CONSTRAINT "merchant_branches_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "merchant_staff" ADD CONSTRAINT "merchant_staff_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "merchant_staff" ADD CONSTRAINT "merchant_staff_branch_id_merchant_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."merchant_branches"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "merchant_staff" ADD CONSTRAINT "merchant_staff_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "merchant_branches_merchant_idx" ON "merchant_branches" USING btree ("merchant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "merchant_staff_branch_idx" ON "merchant_staff" USING btree ("branch_id","is_active");