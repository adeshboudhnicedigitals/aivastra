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
import { merchantBranches, merchantCatalogItems, merchantStaff, merchants } from './merchant.js';

// CRM phase 3 (docs/superpowers/plans/2026-11-12-crm-phase3-variants-stock-cart.md, spec §6.2).
// Billing happens per variant (size × colour), and stock lives at variant × branch: the same
// size can be in stock at one store and sold out at another.

/** One sellable version of a catalogue item. `barcode` is what a POS bills on (spec §9). */
export const merchantCatalogVariants = pgTable(
  'merchant_catalog_variants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    merchantId: uuid('merchant_id')
      .notNull()
      .references(() => merchants.id, { onDelete: 'cascade' }),
    catalogItemId: uuid('catalog_item_id')
      .notNull()
      .references(() => merchantCatalogItems.id, { onDelete: 'cascade' }),
    // From the garment type's size set, or free text with isCustom (spec: "Free size", "36B").
    size: text('size').notNull(),
    isCustom: boolean('is_custom').notNull().default(false),
    // A custom size the merchant later maps to a standard one, so reports group it (spec §6.2).
    standardSize: text('standard_size'),
    // '' = no colour dimension; part of the uniqueness key, so not null.
    colour: text('colour').notNull().default(''),
    sku: text('sku'),
    barcode: text('barcode'),
    // Null = the item's offer price.
    priceOverridePaise: integer('price_override_paise'),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    bySizeColour: uniqueIndex('merchant_catalog_variants_item_size_colour_uq').on(
      t.catalogItemId,
      t.size,
      t.colour,
    ),
    // A barcode identifies one variant within a merchant (a POS line maps back to it).
    byBarcode: uniqueIndex('merchant_catalog_variants_merchant_barcode_uq')
      .on(t.merchantId, t.barcode)
      .where(sql`${t.barcode} is not null`),
  }),
);

/**
 * Availability of a variant at a branch (spec §6.2 option C). `status` is always set and is what
 * the kiosk reads. `quantity` is set only by a feed, which then owns the row: manual edits to a
 * row whose source is not 'manual' are refused, so two sources never fight.
 */
export const variantBranchStock = pgTable(
  'variant_branch_stock',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    merchantId: uuid('merchant_id')
      .notNull()
      .references(() => merchants.id, { onDelete: 'cascade' }),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => merchantCatalogVariants.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => merchantBranches.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ['in_stock', 'low', 'out'] }).notNull(),
    quantity: integer('quantity'),
    // 'manual' | 'csv' | 'pos' | 'shopify' — extendable text, not an enum (spec §9).
    source: text('source').notNull().default('manual'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedByStaffId: uuid('updated_by_staff_id').references(() => merchantStaff.id, {
      onDelete: 'set null',
    }),
  },
  (t) => ({
    byVariantBranch: uniqueIndex('variant_branch_stock_variant_branch_uq').on(
      t.variantId,
      t.branchId,
    ),
    byBranch: index('variant_branch_stock_branch_idx').on(t.branchId, t.status),
  }),
);
