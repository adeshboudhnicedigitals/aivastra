ALTER TABLE "unlimited_plan_charges" ADD COLUMN "status" text DEFAULT 'recorded' NOT NULL;--> statement-breakpoint
ALTER TABLE "unlimited_plan_charges" ADD COLUMN "razorpay_order_id" text;--> statement-breakpoint
ALTER TABLE "unlimited_plan_charges" ADD COLUMN "razorpay_payment_id" text;--> statement-breakpoint
ALTER TABLE "unlimited_plan_charges" ADD COLUMN "razorpay_signature" text;--> statement-breakpoint
ALTER TABLE "unlimited_plan_charges" ADD CONSTRAINT "unlimited_plan_charges_razorpay_order_id_unique" UNIQUE("razorpay_order_id");