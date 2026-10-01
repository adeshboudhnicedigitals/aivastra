CREATE TABLE IF NOT EXISTS "workflow_change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"change_type" text NOT NULL,
	"target_workflow_id" uuid,
	"proposed_by" uuid NOT NULL,
	"proposed_by_role" text NOT NULL,
	"reason" text NOT NULL,
	"previous_limitations" text,
	"proposed_fields" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"resulting_workflow_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_template_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"change_request_id" uuid,
	"applied_by" uuid NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_change_requests" ADD CONSTRAINT "workflow_change_requests_target_workflow_id_workflow_templates_id_fk" FOREIGN KEY ("target_workflow_id") REFERENCES "public"."workflow_templates"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_change_requests" ADD CONSTRAINT "workflow_change_requests_proposed_by_users_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_change_requests" ADD CONSTRAINT "workflow_change_requests_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_change_requests" ADD CONSTRAINT "workflow_change_requests_resulting_workflow_id_workflow_templates_id_fk" FOREIGN KEY ("resulting_workflow_id") REFERENCES "public"."workflow_templates"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_workflow_template_id_workflow_templates_id_fk" FOREIGN KEY ("workflow_template_id") REFERENCES "public"."workflow_templates"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_change_request_id_workflow_change_requests_id_fk" FOREIGN KEY ("change_request_id") REFERENCES "public"."workflow_change_requests"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_applied_by_users_id_fk" FOREIGN KEY ("applied_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_change_requests_status_created_idx" ON "workflow_change_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_change_requests_target_idx" ON "workflow_change_requests" USING btree ("target_workflow_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_change_requests_proposed_by_idx" ON "workflow_change_requests" USING btree ("proposed_by");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_versions_template_version_idx" ON "workflow_versions" USING btree ("workflow_template_id","version_number");
--> statement-breakpoint
-- Workflow governance: MODERATOR/ADMIN can only reach workflow_templates through
-- the propose->approve queue from here on; SUPER_ADMIN keeps direct write access
-- and gains review rights over the queue.
INSERT INTO "permissions" ("key", "description") VALUES
  ('workflow_change_requests.propose', 'Propose new or changed workflow templates for review'),
  ('workflow_change_requests.review', 'Approve or reject proposed workflow template changes')
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("role", "permission_id")
SELECT r.role, p."id"
FROM "permissions" p
CROSS JOIN (VALUES ('SUPER_ADMIN'), ('MODERATOR'), ('ADMIN')) AS r(role)
WHERE p."key" = 'workflow_change_requests.propose'
ON CONFLICT ("role", "permission_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("role", "permission_id")
SELECT 'SUPER_ADMIN', "id" FROM "permissions" WHERE "key" = 'workflow_change_requests.review'
ON CONFLICT ("role", "permission_id") DO NOTHING;
--> statement-breakpoint
-- MODERATOR no longer edits workflow_templates directly — it must go through a
-- change request like ADMIN already does. SUPER_ADMIN is unaffected.
DELETE FROM "role_permissions"
WHERE "role" = 'MODERATOR'
  AND "permission_id" = (SELECT "id" FROM "permissions" WHERE "key" = 'workflows.write');