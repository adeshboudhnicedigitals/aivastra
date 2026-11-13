CREATE TABLE IF NOT EXISTS "analytics_buckets" (
	"merchant_id" uuid NOT NULL,
	"bucket_start" timestamp with time zone NOT NULL,
	"event" text NOT NULL,
	"branch_id" uuid,
	"device_id" uuid,
	"staff_id" uuid,
	"channel" text,
	"count" bigint NOT NULL,
	"value_sum" bigint DEFAULT 0 NOT NULL,
	"value_count" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "analytics_buckets_key_uq" UNIQUE NULLS NOT DISTINCT("merchant_id","bucket_start","event","branch_id","device_id","staff_id","channel")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "analytics_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_event_id" uuid,
	"event" text NOT NULL,
	"merchant_id" uuid NOT NULL,
	"branch_id" uuid,
	"device_id" uuid,
	"staff_id" uuid,
	"session_id" uuid,
	"shopper_id" uuid,
	"catalog_item_id" uuid,
	"variant_id" uuid,
	"channel" text,
	"props" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "analytics_rollup_state" (
	"id" text PRIMARY KEY NOT NULL,
	"watermark" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_buckets_merchant_time_idx" ON "analytics_buckets" USING btree ("merchant_id","bucket_start");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "analytics_events_device_client_uq" ON "analytics_events" USING btree ("device_id","client_event_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_events_merchant_time_idx" ON "analytics_events" USING btree ("merchant_id","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_events_received_idx" ON "analytics_events" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_events_session_idx" ON "analytics_events" USING btree ("session_id") WHERE "analytics_events"."session_id" is not null;--> statement-breakpoint
-- Backfill (hand-written, analytics phase 1 plan Task 2): replay existing in-store rows as
-- server events so the first rollup covers history. Before this ships, check production
-- row counts READ-ONLY (select count(*) from instore_sessions / session_items); expected
-- ~0, since no tablet client calls /v1/device/* yet.
-- Idempotent: ids are md5(source id || ':' || event)::uuid and every insert is
-- ON CONFLICT (id) DO NOTHING, so a re-run (or a restored snapshot) adds nothing.
-- Attribution mirrors apps/api/src/modules/merchant/analytics/queries.ts: tried/sold belong
-- to session_items.staff_id; a wishlist to the item's staff, else the session's (ITEM_STAFF).
INSERT INTO "analytics_events" ("id","event","merchant_id","branch_id","device_id","staff_id","session_id","channel","props","occurred_at","received_at")
SELECT md5(s.id::text || ':session_started')::uuid, 'session_started', s.merchant_id, s.branch_id, s.device_id, s.staff_id, s.id, s.mode,
  '{"backfilled":true}'::jsonb, s.started_at, now()
FROM "instore_sessions" s
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "analytics_events" ("id","event","merchant_id","branch_id","device_id","staff_id","session_id","channel","props","occurred_at","received_at")
SELECT md5(s.id::text || ':session_ended')::uuid, 'session_ended', s.merchant_id, s.branch_id, s.device_id, s.staff_id, s.id, s.mode,
  '{"backfilled":true,"reason":"unknown"}'::jsonb, s.ended_at, now()
FROM "instore_sessions" s
WHERE s.ended_at IS NOT NULL
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "analytics_events" ("id","event","merchant_id","branch_id","device_id","staff_id","session_id","catalog_item_id","channel","props","occurred_at","received_at")
SELECT md5(i.id::text || ':' || e.event)::uuid, e.event, s.merchant_id, s.branch_id, s.device_id,
  CASE WHEN i.action = 'wishlisted' THEN coalesce(i.staff_id, s.staff_id) ELSE i.staff_id END,
  s.id, i.catalog_item_id, s.mode,
  CASE WHEN i.job_id IS NOT NULL
    THEN jsonb_build_object('backfilled', true, 'jobId', i.job_id::text)
    ELSE '{"backfilled":true}'::jsonb END,
  i.created_at, now()
FROM "session_items" i
JOIN "instore_sessions" s ON s.id = i.session_id
JOIN (VALUES ('tried','tryon_requested'), ('wishlisted','item_wishlisted'), ('sold','sale_recorded')) AS e(action, event)
  ON e.action = i.action
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "analytics_events" ("id","event","merchant_id","branch_id","device_id","staff_id","session_id","catalog_item_id","channel","props","occurred_at","received_at")
SELECT md5(i.id::text || ':sale_voided')::uuid, 'sale_voided', s.merchant_id, s.branch_id, s.device_id, i.staff_id,
  s.id, i.catalog_item_id, s.mode,
  jsonb_strip_nulls(jsonb_build_object('backfilled', true, 'voidedBy', i.voided_by::text)),
  i.voided_at, now()
FROM "session_items" i
JOIN "instore_sessions" s ON s.id = i.session_id
WHERE i.action = 'sold' AND i.voided_at IS NOT NULL
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
-- The epoch, not '-infinity': drizzle maps timestamptz to a JS Date, which cannot hold infinity.
INSERT INTO "analytics_rollup_state" ("id","watermark") VALUES ('default', '1970-01-01T00:00:00Z')
ON CONFLICT ("id") DO NOTHING;
