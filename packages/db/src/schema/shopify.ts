import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { workflowTemplates } from './models.js';
import { users } from './users.js';
export interface ShopifyStoreLimits {
  /** null = off. Hard ceiling on generations per store-local day. */
  storeDailyCap?: number | null;
  /** null = off. Soft — defeatable by a fresh browser; see the design doc. */
  perShopperCap?: number | null;
  perShopperWindow?: 'day' | 'week' | 'month';
  /** null = never ask. 0 = ask before the first generation. */
  emailAfterNTryOns?: number | null;
}

export interface ShopifyStoreRetention {
  /** null = off, for all three. Days until deletion. */
  shopperPhotoDays?: number | null;
  resultDays?: number | null;
  shopperRecordDays?: number | null;
}

export interface ShopifyWidgetTheme {
  /** Hex (#rrggbb). Drives modal CTA, step dots, choose-photo button, retry. */
  accentColor?: string | null;
}

export interface ShopifyWidgetCopy {
  heading?: string | null;
  subheading?: string | null;
  uploadTitle?: string | null;
  uploadLead?: string | null;
  chooseLabel?: string | null;
  ctaLabel?: string | null;
  legalText?: string | null;
  generatingText?: string | null;
  errorText?: string | null;
}

export interface ShopifyWidgetBehavior {
  addToCart?: boolean;
  addToCartLabel?: string | null;
  share?: boolean;
  shareLabel?: string | null;
}

export interface ShopifyWidgetConfig {
  theme?: ShopifyWidgetTheme;
  copy?: ShopifyWidgetCopy;
  behavior?: ShopifyWidgetBehavior;
}

export interface ShopifyStoreSettings {
  workflowTemplateId?: string;
  themeBlockConfirmed?: boolean;
  limits?: ShopifyStoreLimits;
  retention?: ShopifyStoreRetention;
  widget?: ShopifyWidgetConfig;
  /** False while the authoritative widget config has not reached Shopify. */
  widgetConfigSynced?: boolean;
}

export interface FunnelRuleCondition {
  field: 'product_type' | 'tags' | 'vendor' | 'collections';
  operator: 'equals' | 'contains';
  value: string;
}

export const shopifyStores = pgTable('shopify_stores', {
  id: uuid('id').primaryKey().defaultRandom(),
  storeKey: uuid('store_key').notNull().unique().defaultRandom(),
  allowedOrigins: text('allowed_origins').array().notNull().default([]),
  shopDomain: text('shop_domain').notNull().unique(),
  shopifyShopId: bigint('shopify_shop_id', { mode: 'number' }).notNull().unique(),
  accessToken: text('access_token').notNull(), // encrypted: iv:authTag:ciphertext
  // All three are nullable because stores installed before expiring tokens
  // shipped hold a perpetual access token with no refresh half. Null
  // refreshToken is the marker for "legacy, never refresh" — see
  // getValidAccessToken in apps/api/src/modules/shopify/token.ts.
  refreshToken: text('refresh_token'), // encrypted: iv:authTag:ciphertext
  tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
  scope: text('scope').notNull(),
  // The store's local timezone, from shop.json at install. Drives day
  // boundaries for the store daily cap — a merchant who sets "200/day" and
  // watches it reset at 05:30 local time will file a bug. Null for rows that
  // predate this column; those fall back to UTC until the next reinstall.
  ianaTimezone: text('iana_timezone'),
  ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
  installedAt: timestamp('installed_at', { withTimezone: true }).notNull().defaultNow(),
  uninstalledAt: timestamp('uninstalled_at', { withTimezone: true }),
  settings: jsonb('settings').$type<ShopifyStoreSettings>().notNull().default({}),
  syncCursor: text('sync_cursor'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const shopifyFunnelTemplates = pgTable(
  'shopify_funnel_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    label: text('label').notNull(),
    workflowTemplateId: uuid('workflow_template_id')
      .notNull()
      .references(() => workflowTemplates.id),
    isActive: boolean('is_active').notNull().default(true),
    // Exactly one row carries this. It is the workflow every Shopify product
    // resolves unless something more specific claims it — today nothing does,
    // so it is the only routing input. Enforced by the partial unique index
    // below rather than by application code, because two defaults would make
    // resolution non-deterministic rather than merely wrong.
    isDefault: boolean('is_default').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    singleDefault: uniqueIndex('shopify_funnel_templates_single_default_idx')
      .on(t.isDefault)
      .where(sql`${t.isDefault}`),
  }),
);

export const shopifyFunnelRules = pgTable(
  'shopify_funnel_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => shopifyStores.id, { onDelete: 'cascade' }),
    funnelTemplateId: uuid('funnel_template_id')
      .notNull()
      .references(() => shopifyFunnelTemplates.id, { onDelete: 'cascade' }),
    mode: text('mode').notNull().default('manual'),
    conditions: jsonb('conditions').$type<FunnelRuleCondition[]>().notNull().default([]),
    priority: integer('priority').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uq: unique().on(t.storeId, t.funnelTemplateId),
  }),
);

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
    title: text('title'),
    status: text('status').notNull().default('processing'), // active|processing|failed|deleted
    enabled: boolean('enabled').notNull().default(false),
    failedReason: text('failed_reason'),
    funnelTemplateId: uuid('funnel_template_id').references(() => shopifyFunnelTemplates.id),
    funnelAssignmentSource: text('funnel_assignment_source'),
    productType: text('product_type'),
    tags: text('tags').array(),
    vendor: text('vendor'),
    collections: text('collections').array(),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uq: unique().on(t.storeId, t.shopifyProductId, t.shopifyVariantId),
  }),
);

export const shopifyShoppers = pgTable(
  'shopify_shoppers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => shopifyStores.id, { onDelete: 'cascade' }),
    // Anonymous UUID minted by the widget and held in localStorage. This is the
    // ROW identity: one row per browser, never merged. Counting identity is a
    // separate, stronger signal resolved per request — see modules/shopify/shopper.ts.
    clientId: text('client_id').notNull(),
    shopifyCustomerId: bigint('shopify_customer_id', { mode: 'number' }),
    email: text('email'),
    // Explicit marketing opt-in. The email is recorded regardless (it keys the
    // per-shopper cap), but only consented rows are marketable.
    emailConsent: boolean('email_consent').notNull().default(false),
    emailCapturedAt: timestamp('email_captured_at', { withTimezone: true }),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uq: unique().on(t.storeId, t.clientId),
    byEmail: index('shopify_shoppers_store_email_idx').on(t.storeId, t.email),
    byCustomer: index('shopify_shoppers_store_customer_idx').on(t.storeId, t.shopifyCustomerId),
  }),
);

/**
 * Append-only storefront interaction log, the source for the merchant
 * Analytics page.
 *
 * `bigserial`, not `uuid` — a deliberate break from this repo's convention.
 * This is the highest-write-rate table in the system and random UUIDs scatter
 * B-tree inserts across the whole index and fragment it, where a monotonic key
 * appends to one page. Nothing references these rows across services and there
 * is no need for an unguessable id, so the reason the uuid convention exists
 * does not apply.
 *
 * Rows are ADVISORY. No credit decision, limit check, or authorization read
 * may ever consult this table — the client-reported types are forgeable by
 * anyone who can open devtools.
 */
export const shopifyWidgetEvents = pgTable(
  'shopify_widget_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => shopifyStores.id, { onDelete: 'cascade' }),
    // Matches shopify_shoppers.client_id — how a funnel step joins to a person.
    // Nullable: widget versions predating shopper identity send none.
    clientId: text('client_id'),
    shopifyProductId: bigint('shopify_product_id', { mode: 'number' }),
    // Client-reported, forgeable:
    //   button_click | upload | result_view | add_to_cart | share
    // Server-written, unforgeable:
    //   refused_store_cap | refused_shopper_cap | refused_email_gate
    type: text('type').notNull(),
    device: text('device'), // 'mobile' | 'desktop'
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byStoreTime: index('shopify_widget_events_store_time_idx').on(t.storeId, t.createdAt),
    byStoreTypeTime: index('shopify_widget_events_store_type_time_idx').on(
      t.storeId,
      t.type,
      t.createdAt,
    ),
    byStoreProductTime: index('shopify_widget_events_store_product_time_idx').on(
      t.storeId,
      t.shopifyProductId,
      t.createdAt,
    ),
  }),
);
