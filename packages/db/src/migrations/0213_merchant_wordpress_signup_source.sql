ALTER TABLE "merchants"
DROP CONSTRAINT "merchants_signup_source_check";
--> statement-breakpoint
ALTER TABLE "merchants"
ADD CONSTRAINT "merchants_signup_source_check"
CHECK ("signup_source" IN ('admin', 'android_google', 'wordpress'));
