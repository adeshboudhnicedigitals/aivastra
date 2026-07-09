import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { jobs } from './jobs.js';
import { users } from './users.js';

export const merchants = pgTable('merchants', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyName: text('company_name').notNull(),
  contactName: text('contact_name').notNull(),
  phone: text('phone').notNull(),
  websiteUrl: text('website_url').notNull(),
  companySize: text('company_size').notNull(),
  purpose: text('purpose').notNull(),
  businessAddress: text('business_address').notNull(),
  isActive: boolean('is_active').notNull().default(false),
  kioskEnabled: boolean('kiosk_enabled').notNull().default(false),
  maxKioskDevices: integer('max_kiosk_devices').notNull().default(5),
  webhookUrl: text('webhook_url'),
  webhookSecret: text('webhook_secret'),
  // Login credentials live on `users` — a merchant IS a user with a merchants
  // profile attached (same pattern as admin_users). One merchant account per user.
  userId: uuid('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const merchantCredits = pgTable('merchant_credits', {
  merchantId: uuid('merchant_id')
    .primaryKey()
    .references(() => merchants.id, { onDelete: 'cascade' }),
  balance: integer('balance').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const merchantPayments = pgTable('merchant_payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  merchantId: uuid('merchant_id')
    .notNull()
    .references(() => merchants.id, { onDelete: 'cascade' }),
  planId: text('plan_id').notNull(),
  razorpayOrderId: text('razorpay_order_id').notNull().unique(),
  razorpayPaymentId: text('razorpay_payment_id'),
  razorpaySignature: text('razorpay_signature'),
  basePaise: integer('base_paise').notNull(),
  gstPaise: integer('gst_paise').notNull(),
  totalPaise: integer('total_paise').notNull(),
  credits: integer('credits').notNull(),
  status: text('status').notNull().default('created'), // created | paid | failed
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  paidAt: timestamp('paid_at', { withTimezone: true }),
});

export const merchantCreditLedger = pgTable('merchant_credit_ledger', {
  id: uuid('id').primaryKey().defaultRandom(),
  merchantId: uuid('merchant_id')
    .notNull()
    .references(() => merchants.id, { onDelete: 'cascade' }),
  delta: integer('delta').notNull(),
  reason: text('reason').notNull(),
  jobId: uuid('job_id'),
  adminId: uuid('admin_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const merchantCatalogItems = pgTable(
  'merchant_catalog_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    merchantId: uuid('merchant_id')
      .notNull()
      .references(() => merchants.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    sku: text('sku'),
    gender: text('gender'),
    category: text('category'),
    r2Key: text('r2_key').notNull(),
    thumbnailKey: text('thumbnail_key').notNull(),
    sourceJobId: uuid('source_job_id').references(() => jobs.id, { onDelete: 'set null' }),
    isActive: boolean('is_active').notNull().default(true),
    moderationStatus: text('moderation_status').notNull().default('approved'),
    moderationNote: text('moderation_note'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('merchant_catalog_items_merchant_idx').on(t.merchantId, t.isActive),
    uniqueIndex('merchant_catalog_items_merchant_source_job_unique')
      .on(t.merchantId, t.sourceJobId)
      .where(sql`${t.sourceJobId} is not null`),
  ],
);
