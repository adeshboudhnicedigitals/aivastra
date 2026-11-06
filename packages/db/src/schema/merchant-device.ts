import { sql } from 'drizzle-orm';
import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { merchantBranches, merchantStaff, merchants } from './merchant.js';

// v1.0 step 2 (docs/superpowers/specs/2026-11-06-v1-devices-sessions-entitlement-design.md).
// A tablet paired to one branch. Only sha256 hashes of the pairing code and token are
// stored (like api_keys); the token is shown to the device once.
export const merchantDevices = pgTable(
  'merchant_devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    merchantId: uuid('merchant_id')
      .notNull()
      .references(() => merchants.id, { onDelete: 'cascade' }),
    // No cascade: a branch with devices is deactivated, never deleted.
    branchId: uuid('branch_id')
      .notNull()
      .references(() => merchantBranches.id),
    name: text('name').notNull(),
    // Null until paired. Unique so a token resolves to exactly one device.
    deviceTokenHash: text('device_token_hash').unique(),
    pairingCodeHash: text('pairing_code_hash'),
    pairingExpiresAt: timestamp('pairing_expires_at', { withTimezone: true }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byBranch: index('merchant_devices_branch_idx').on(t.branchId, t.isActive),
    byMerchant: index('merchant_devices_merchant_idx').on(t.merchantId),
    // POST /v1/device/pair looks a code up by hash with no other predicate. Partial: paired
    // devices have it nulled, and a unique index must tolerate many NULLs anyway.
    pairingCode: uniqueIndex('merchant_devices_pairing_code_hash_uq')
      .on(t.pairingCodeHash)
      .where(sql`${t.pairingCodeHash} is not null`),
  }),
);

// One in-store visit. shopper_id / consent columns arrive with step 5.
export const instoreSessions = pgTable(
  'instore_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    merchantId: uuid('merchant_id')
      .notNull()
      .references(() => merchants.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => merchantBranches.id),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => merchantDevices.id),
    staffId: uuid('staff_id').references(() => merchantStaff.id),
    mode: text('mode', { enum: ['kiosk', 'assisted'] }).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byDevice: index('instore_sessions_device_idx').on(t.deviceId, t.endedAt),
    byMerchant: index('instore_sessions_merchant_idx').on(t.merchantId, t.startedAt),
    // The idle sweeper scans only open sessions by last activity; ended ones are the bulk.
    openByActivity: index('instore_sessions_open_activity_idx')
      .on(t.lastActivityAt)
      .where(sql`${t.endedAt} is null`),
  }),
);

// catalog_item_id has no FK on purpose: try-on can target admin demo items, which
// are not merchant-owned rows. Undoing a sale sets voided_at — never a delete.
export const sessionItems = pgTable(
  'session_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => instoreSessions.id, { onDelete: 'cascade' }),
    catalogItemId: uuid('catalog_item_id').notNull(),
    jobId: uuid('job_id'),
    action: text('action', { enum: ['tried', 'wishlisted', 'sold'] }).notNull(),
    staffId: uuid('staff_id').references(() => merchantStaff.id),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidedBy: uuid('voided_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    bySession: index('session_items_session_idx').on(t.sessionId),
  }),
);
