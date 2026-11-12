import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { merchantCatalogVariants } from './inventory.js';
import { merchantBranches, merchantStaff, merchants } from './merchant.js';
import { instoreSessions } from './merchant-device.js';

// CRM phase 3, slice 3b (spec §6.1, §9). A cart is NOT a sale: a line becomes sold only when
// it is confirmed as billed (by staff now, by a POS later: `billed_source`). A kiosk shopper
// walks to the counter after the tablet has gone home, so a cart outlives its session and is
// billed by its code; unbilled carts are marked abandoned after 24 hours (cart sweeper).

export const carts = pgTable(
  'carts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    merchantId: uuid('merchant_id')
      .notNull()
      .references(() => merchants.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => merchantBranches.id),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => instoreSessions.id, { onDelete: 'cascade' }),
    // Stable and unguessable from v1 (spec §9): what the counter types, and what a POS will
    // look up later. Shown on the tablet next to the barcodes.
    cartCode: text('cart_code').notNull(),
    status: text('status', { enum: ['open', 'billed', 'abandoned'] })
      .notNull()
      .default('open'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (t) => ({
    bySession: uniqueIndex('carts_session_uq').on(t.sessionId),
    byCode: uniqueIndex('carts_cart_code_uq').on(t.cartCode),
    openByAge: index('carts_open_created_idx').on(t.createdAt).where(sql`${t.status} = 'open'`),
  }),
);

export const cartLines = pgTable(
  'cart_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cartId: uuid('cart_id')
      .notNull()
      .references(() => carts.id, { onDelete: 'cascade' }),
    merchantId: uuid('merchant_id')
      .notNull()
      .references(() => merchants.id, { onDelete: 'cascade' }),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => merchantCatalogVariants.id),
    catalogItemId: uuid('catalog_item_id').notNull(),
    quantity: integer('quantity').notNull().default(1),
    // Who put it there: the shopper (kiosk) or the assisting staff member.
    addedBy: text('added_by', { enum: ['shopper', 'staff'] }).notNull(),
    addedByStaffId: uuid('added_by_staff_id').references(() => merchantStaff.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    removedAt: timestamp('removed_at', { withTimezone: true }),
    billedAt: timestamp('billed_at', { withTimezone: true }),
    // 'staff' now; 'pos' later; extendable (spec §9).
    billedSource: text('billed_source'),
    // Per unit, at billing time: real revenue line by line (spec §9).
    billedPricePaise: integer('billed_price_paise'),
    billedByStaffId: uuid('billed_by_staff_id').references(() => merchantStaff.id, {
      onDelete: 'set null',
    }),
    // The session_items 'sold' rows this line produced, one per unit (plan P2).
    sessionItemIds: jsonb('session_item_ids').$type<string[]>(),
  },
  (t) => ({
    byCart: index('cart_lines_cart_idx').on(t.cartId),
  }),
);
