import { sql } from 'drizzle-orm';
import {
  bigint,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// Analytics phase 1 (docs/superpowers/plans/2026-11-12-analytics-events-foundation.md).
//
// ADVISORY ONLY: nothing here may be read for a credit, limit, entitlement or authorization
// decision. Client-reported rows are forgeable by construction, and the source tables
// (instore_sessions, session_items, jobs, credit_ledger) stay the truth for anything that
// moves money or grants access.
//
// No foreign keys, on purpose. Server events are inserted inside source transactions (a
// session start, a paid try-on's charge), so the insert must not be able to fail for any
// reason except the database itself failing. Dimensions also have to survive the rows they
// point at (a deleted session, a demo catalog item that is not a merchant row) for history
// to stay countable.
export const analyticsEvents = pgTable(
  'analytics_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // The device's own id for a client event; the dedupe key per device (retry / offline
    // replay). Null for server events, which are written exactly once by their transaction.
    clientEventId: uuid('client_event_id'),
    // Validated in packages/types (analytics-events.ts), not a Postgres enum, so later phases
    // add a name rather than a migration.
    event: text('event').notNull(),
    merchantId: uuid('merchant_id').notNull(),
    branchId: uuid('branch_id'),
    deviceId: uuid('device_id'),
    staffId: uuid('staff_id'),
    sessionId: uuid('session_id'),
    // Step 5 (identification) and the cart/inventory phase fill these; null until then.
    shopperId: uuid('shopper_id'),
    catalogItemId: uuid('catalog_item_id'),
    variantId: uuid('variant_id'),
    // kiosk | assisted today; shopify / wordpress / whatsapp / pos as those channels join.
    channel: text('channel'),
    props: jsonb('props').$type<Record<string, string | number | boolean>>().notNull().default({}),
    // When it happened (device clock for client events, clamped on ingest).
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    // When the server stored it: the rollup watermark scans this, so a late offline upload
    // still reaches the bucket of its occurred_at.
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Server events have a null client_event_id, and NULLs are distinct in a plain unique
    // index, so only client events are constrained here.
    clientDedupe: uniqueIndex('analytics_events_device_client_uq').on(t.deviceId, t.clientEventId),
    byMerchantTime: index('analytics_events_merchant_time_idx').on(t.merchantId, t.occurredAt),
    byReceived: index('analytics_events_received_idx').on(t.receivedAt),
    bySession: index('analytics_events_session_idx')
      .on(t.sessionId)
      .where(sql`${t.sessionId} is not null`),
  }),
);

// 15-minute UTC buckets (plan D3: IST is +5:30, so an hourly UTC bucket cannot be read back
// as an IST hour). Rebuilt per (merchant, bucket) by the rollup loop; never edited in place.
export const analyticsBuckets = pgTable(
  'analytics_buckets',
  {
    merchantId: uuid('merchant_id').notNull(),
    bucketStart: timestamp('bucket_start', { withTimezone: true }).notNull(),
    event: text('event').notNull(),
    branchId: uuid('branch_id'),
    deviceId: uuid('device_id'),
    staffId: uuid('staff_id'),
    channel: text('channel'),
    count: bigint('count', { mode: 'number' }).notNull(),
    // Event-specific measure, e.g. try-on wait time in ms; average = value_sum / value_count.
    valueSum: bigint('value_sum', { mode: 'number' }).notNull().default(0),
    valueCount: bigint('value_count', { mode: 'number' }).notNull().default(0),
  },
  (t) => ({
    // NULLS NOT DISTINCT (Postgres 15+): a kiosk row has no staff_id, and two such rows for
    // the same bucket must collide rather than coexist.
    key: unique('analytics_buckets_key_uq')
      .on(t.merchantId, t.bucketStart, t.event, t.branchId, t.deviceId, t.staffId, t.channel)
      .nullsNotDistinct(),
    byMerchantTime: index('analytics_buckets_merchant_time_idx').on(t.merchantId, t.bucketStart),
  }),
);

// One row ('default'): the rollup's high-water mark over analytics_events.received_at and
// jobs.completed_at. Seeded at the epoch by the migration so the first tick builds everything.
export const analyticsRollupState = pgTable('analytics_rollup_state', {
  id: text('id').primaryKey(),
  watermark: timestamp('watermark', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
