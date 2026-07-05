import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
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
