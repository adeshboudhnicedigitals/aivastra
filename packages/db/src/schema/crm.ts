import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { merchants } from './merchant.js';
import { users } from './users.js';

// CRM phase 2 (docs/superpowers/plans/2026-11-12-crm-identification-mode-a.md).
//
// Data roles (spec §3): the MERCHANT is the Data Fiduciary, AiVastra the Data Processor. Every
// row here belongs to one merchant and is never joined across merchants: the same person at two
// brands is two unrelated shoppers. Phone numbers are stored encrypted plus a keyed hash for
// lookup (CRM_DATA_KEY subkeys, modules/crm/crypto.ts), never in clear.

/**
 * The brand's own WhatsApp Business number (mode A). Connected by manual entry today; Meta
 * Embedded Signup will write the same row later (spec §4.1 A2). Token and app secret are
 * AES-256-GCM sealed; they never leave the API.
 */
export const merchantWhatsappChannels = pgTable(
  'merchant_whatsapp_channels',
  {
    merchantId: uuid('merchant_id')
      .primaryKey()
      .references(() => merchants.id, { onDelete: 'cascade' }),
    wabaId: text('waba_id').notNull(),
    // Meta's id for the number; webhooks are routed by it (spec §4.1 A3).
    phoneNumberId: text('phone_number_id').notNull(),
    // E.164 digits without '+', as wa.me wants them.
    displayNumber: text('display_number').notNull(),
    accessTokenEnc: text('access_token_enc').notNull(),
    // The merchant's own Meta app signs its webhooks with this.
    appSecretEnc: text('app_secret_enc').notNull(),
    connectedAt: timestamp('connected_at', { withTimezone: true }).notNull().defaultNow(),
    connectedBy: uuid('connected_by').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // One number belongs to one merchant: a second merchant claiming it is refused.
    byPhoneNumberId: uniqueIndex('merchant_whatsapp_channels_phone_number_id_uq').on(
      t.phoneNumberId,
    ),
  }),
);

/**
 * Per-merchant CRM choices. Retention has NO default (spec Q4): identification stays off until
 * the merchant has chosen both periods.
 */
export const merchantCrmSettings = pgTable('merchant_crm_settings', {
  merchantId: uuid('merchant_id')
    .primaryKey()
    .references(() => merchants.id, { onDelete: 'cascade' }),
  // 'end' (default, spec decision 3) | 'start'
  identifyAt: text('identify_at', { enum: ['end', 'start'] })
    .notNull()
    .default('end'),
  photoRetentionDays: integer('photo_retention_days'),
  profileRetentionDays: integer('profile_retention_days'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
});

/** A merchant's customer, unique on (merchant, phone). Deleted = profile wiped, row kept. */
export const shoppers = pgTable(
  'shoppers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    merchantId: uuid('merchant_id')
      .notNull()
      .references(() => merchants.id, { onDelete: 'cascade' }),
    // Null once the profile is deleted (retention or a deletion request).
    phoneEnc: text('phone_enc'),
    phoneHash: text('phone_hash'),
    // WhatsApp profile name at first contact; personal data, wiped with the phone.
    displayName: text('display_name'),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    byPhone: uniqueIndex('shoppers_merchant_phone_hash_uq')
      .on(t.merchantId, t.phoneHash)
      .where(sql`${t.phoneHash} is not null`),
    // The retention sweeper scans live profiles by last visit.
    liveByLastSeen: index('shoppers_live_last_seen_idx')
      .on(t.lastSeenAt)
      .where(sql`${t.deletedAt} is null`),
  }),
);

/**
 * Append-only consent history (spec §3: two consents, never bundled, versioned, withdrawable).
 * The current state of a kind is its latest row. Kept after a profile deletion, anonymised by
 * the wiped phone, as the record that consent existed when data was processed.
 */
export const shopperConsents = pgTable(
  'shopper_consents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopperId: uuid('shopper_id')
      .notNull()
      .references(() => shoppers.id, { onDelete: 'cascade' }),
    merchantId: uuid('merchant_id')
      .notNull()
      .references(() => merchants.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['looks', 'marketing'] }).notNull(),
    granted: boolean('granted').notNull(),
    // The wording the shopper saw (C5: 'v0-draft' until legal review).
    version: text('version').notNull(),
    // 'whatsapp_button' | 'whatsapp_stop' | ...
    source: text('source').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byShopper: index('shopper_consents_shopper_idx').on(t.shopperId, t.kind, t.createdAt),
  }),
);

/** A saved customer filter (CRM phase 4, decision K3): the same shape the list query takes. */
export const merchantCustomerSegments = pgTable(
  'merchant_customer_segments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    merchantId: uuid('merchant_id')
      .notNull()
      .references(() => merchants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    // Validated by CustomerFilters (packages/types/src/customers.ts) on write and on read.
    filters: jsonb('filters').$type<Record<string, unknown>>().notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byMerchantName: uniqueIndex('merchant_customer_segments_merchant_name_uq').on(
      t.merchantId,
      t.name,
    ),
  }),
);
