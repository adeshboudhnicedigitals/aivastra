import { boolean, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export interface WidgetSettings {
  widgetName?: string;
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
  primaryColor?: string;
  buttonColor?: string;
  bgColor?: string;
  borderRadius?: number;
  shadow?: boolean;
  minSizeMb?: number;
  maxSizeMb?: number;
  cameraUpload?: boolean;
  customCss?: string;
}

export const widgetClients = pgTable('widget_clients', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyName: text('company_name').notNull(),
  contactName: text('contact_name').notNull(),
  email: text('email').notNull().unique(),
  phone: text('phone').notNull(),
  websiteUrl: text('website_url').notNull(),
  companySize: text('company_size').notNull(),
  purpose: text('purpose').notNull(),
  businessAddress: text('business_address').notNull(),
  passwordHash: text('password_hash').notNull(),
  widgetKey: uuid('widget_key').notNull().unique().defaultRandom(),
  isActive: boolean('is_active').notNull().default(true),
  allowedOrigins: text('allowed_origins').array().notNull().default([]),
  settings: jsonb('settings').$type<WidgetSettings>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const widgetClientCredits = pgTable('widget_client_credits', {
  widgetClientId: uuid('widget_client_id')
    .primaryKey()
    .references(() => widgetClients.id, { onDelete: 'cascade' }),
  balance: integer('balance').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const merchantPayments = pgTable('merchant_payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  widgetClientId: uuid('widget_client_id')
    .notNull()
    .references(() => widgetClients.id, { onDelete: 'cascade' }),
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

export const widgetCreditLedger = pgTable('widget_credit_ledger', {
  id: uuid('id').primaryKey().defaultRandom(),
  widgetClientId: uuid('widget_client_id')
    .notNull()
    .references(() => widgetClients.id, { onDelete: 'cascade' }),
  delta: integer('delta').notNull(),
  reason: text('reason').notNull(),
  jobId: uuid('job_id'),
  adminId: uuid('admin_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
