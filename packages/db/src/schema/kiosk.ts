import { pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { jobs } from './jobs.js';
import { widgetClients } from './widget.js';

export const kioskDevices = pgTable('kiosk_devices', {
  id: uuid('id').primaryKey().defaultRandom(),
  widgetClientId: uuid('widget_client_id')
    .notNull()
    .references(() => widgetClients.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  status: text('status').notNull().default('pending'),
  pairingCodeHash: text('pairing_code_hash'),
  pairingCodeExpiresAt: timestamp('pairing_code_expires_at', { withTimezone: true }),
  androidId: text('android_id'),
  appVersion: text('app_version'),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  pairedAt: timestamp('paired_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const kioskResultLikes = pgTable(
  'kiosk_result_likes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    widgetClientId: uuid('widget_client_id')
      .notNull()
      .references(() => widgetClients.id, { onDelete: 'cascade' }),
    kioskDeviceId: uuid('kiosk_device_id').references(() => kioskDevices.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: unique('kiosk_result_likes_job_widget_unique').on(t.jobId, t.widgetClientId),
  }),
);

export const kioskResultCartItems = pgTable(
  'kiosk_result_cart_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    widgetClientId: uuid('widget_client_id')
      .notNull()
      .references(() => widgetClients.id, { onDelete: 'cascade' }),
    kioskDeviceId: uuid('kiosk_device_id').references(() => kioskDevices.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: unique('kiosk_result_cart_items_job_widget_unique').on(t.jobId, t.widgetClientId),
  }),
);
