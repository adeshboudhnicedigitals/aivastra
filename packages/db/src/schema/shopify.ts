import {
  bigint,
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { widgetClients } from './widget.js';

export interface ShopifyStoreSettings {
  buttonText?: string;
  buttonColor?: string;
  position?: string;
  customCss?: string;
  workflowTemplateId?: string;
}

export const shopifyPlans = pgTable('shopify_plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  priceCents: integer('price_cents').notNull(),
  includedTryons: integer('included_tryons').notNull(),
  overageCents: integer('overage_cents').notNull(),
  trialDays: integer('trial_days').notNull().default(7),
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const shopifyStores = pgTable('shopify_stores', {
  id: uuid('id').primaryKey().defaultRandom(),
  widgetClientId: uuid('widget_client_id')
    .notNull()
    .unique()
    .references(() => widgetClients.id, { onDelete: 'cascade' }),
  shopDomain: text('shop_domain').notNull().unique(),
  shopifyShopId: bigint('shopify_shop_id', { mode: 'number' }).notNull().unique(),
  accessToken: text('access_token').notNull(), // encrypted: iv:authTag:ciphertext
  scope: text('scope').notNull(),
  billingPlanId: bigint('billing_plan_id', { mode: 'number' }),
  shopifyPlanId: uuid('shopify_plan_id').references(() => shopifyPlans.id),
  installedAt: timestamp('installed_at', { withTimezone: true }).notNull().defaultNow(),
  uninstalledAt: timestamp('uninstalled_at', { withTimezone: true }),
  settings: jsonb('settings').$type<ShopifyStoreSettings>().notNull().default({}),
  syncCursor: text('sync_cursor'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const shopifyProductGarments = pgTable(
  'shopify_product_garments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => shopifyStores.id, { onDelete: 'cascade' }),
    shopifyProductId: bigint('shopify_product_id', { mode: 'number' }).notNull(),
    shopifyVariantId: bigint('shopify_variant_id', { mode: 'number' }),
    r2Key: text('r2_key').notNull(),
    status: text('status').notNull().default('processing'), // active|processing|failed|deleted
    failedReason: text('failed_reason'),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uq: unique().on(t.storeId, t.shopifyProductId, t.shopifyVariantId),
  }),
);
