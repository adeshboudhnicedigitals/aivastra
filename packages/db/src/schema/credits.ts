import { boolean, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const creditPlans = pgTable('credit_plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  subtext: text('subtext').notNull().default(''),
  credits: integer('credits').notNull(),
  basePaise: integer('base_paise').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  isHighlighted: boolean('is_highlighted').notNull().default(false),
  badge: text('badge'),
  sortOrder: integer('sort_order').notNull().default(0),
  // 'priority' | 'normal' | 'low' — maps users who purchased this plan to a queue tier
  queueStream: text('queue_stream').notNull().default('normal'),
  // watermark: true → jobs created under this plan are watermarked (default true for free plan)
  watermark: boolean('watermark').notNull().default(false),
  // 'catalogue' | 'tryon' — which pricing tab this plan is sold under. Each is a
  // fully independent purchasable SKU (own slug/price/credits); a plan never
  // appears on both tabs. The free plan is 'catalogue' by convention but is
  // filtered out of both tabs by slug ('free') regardless.
  planType: text('plan_type').notNull().default('catalogue'),
  // Freeform marketing price label shown on the public pricing card (e.g.
  // "₹12.50 per Catalogue photo" or "₹6.25 per Try-on photo") — admin-editable,
  // optional, null means the row isn't rendered.
  perUnitPriceLabel: text('per_unit_price_label'),
  // Freeform "included units" label shown next to the price (e.g. "80 Images"
  // or "160 Try-Ons") — same optional/admin-editable convention.
  unitCountLabel: text('unit_count_label'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const payments = pgTable('payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  planId: text('plan_id').notNull(),
  razorpayOrderId: text('razorpay_order_id').notNull().unique(),
  razorpayPaymentId: text('razorpay_payment_id'),
  razorpaySignature: text('razorpay_signature'),
  basePaise: integer('base_paise').notNull(),
  gstPaise: integer('gst_paise').notNull(),
  totalPaise: integer('total_paise').notNull(),
  credits: integer('credits').notNull(),
  // Optional — captured at order-creation time (POST /v1/payments/orders).
  // Independent of users.gstin: pre-filled from the profile value but
  // editable per purchase without writing back to the profile.
  gstin: text('gstin'),
  status: text('status').notNull().default('created'), // created | paid | failed
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  paidAt: timestamp('paid_at', { withTimezone: true }),
});

export const userCredits = pgTable('user_credits', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  balance: integer('balance').notNull().default(0),
  // Stamped when the low-credit alert email fires (balance crossed below the
  // threshold) so the scheduler sends it once per dip, not once per tick.
  // Cleared when the balance recovers back to/above the threshold, re-arming
  // the alert for a future dip — mirrors shopify_stores.last_alert_level's
  // escalate-then-reset shape, just for a single threshold instead of levels.
  lowCreditAlertSentAt: timestamp('low_credit_alert_sent_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Admin-granted, time-boxed plan for negotiated/bargain deals: for the window
// [startAt, endAt] this user's job-credit spend bypasses the balance check
// entirely (see getActiveUnlimitedPlan, apps/api/src/modules/credits/unlimited-plan.ts).
// No purchasable SKU, no tier change — fully decoupled from
// credit_plans/users.tier. Manual/admin-only for now. One active row per user
// at a time (see the partial unique index added alongside this table's
// migration); no history table — a re-grant while active overwrites the row
// in place.
export const unlimitedPlans = pgTable('unlimited_plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  startAt: timestamp('start_at', { withTimezone: true }).notNull(),
  endAt: timestamp('end_at', { withTimezone: true }).notNull(),
  status: text('status').notNull().default('active'), // 'active' | 'expired' | 'revoked'
  note: text('note'),
  // Negotiated, per-user price for this grant — there's no fixed SKU (see
  // table comment), so this is set individually every time an admin grants or
  // renews. Charged again (see unlimitedPlanCharges) on every renewal, not
  // just the first grant.
  pricePaise: integer('price_paise').notNull().default(0),
  // Same 'priority' | 'normal' | 'low' vocabulary as credit_plans.queueStream —
  // overrides the user's tier-derived routing for the life of this grant (see
  // resolveQueueRouting, apps/api/src/modules/jobs/create.ts).
  queueStream: text('queue_stream').notNull().default('normal'),
  // The admin's users.id (not admin_users.id) — matches the credit_ledger.adminId
  // and recordAudit() convention of identifying an admin actor by req.userId.
  grantedBy: uuid('granted_by')
    .notNull()
    .references(() => users.id),
  revokedBy: uuid('revoked_by').references(() => users.id),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  // Escalation-rank column mirroring shopify_stores.last_alert_level +
  // ALERT_LEVEL_RANK (apps/api/src/modules/shopify/runway.ts) — lets the
  // reminder scheduler ask "worse than what we last told them?" numerically.
  // Only 'seven_day'/'three_day' are wired up for now; adding 'expired' later
  // is one more rank value, not a redesign. Reset to 'none' whenever an admin
  // edit pushes endAt later, so an already-reminded user re-arms for the new date.
  lastReminderStage: text('last_reminder_stage').notNull().default('none'), // 'none' | 'seven_day' | 'three_day'
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Append-only billing record for unlimited_plans — one row per time the
// negotiated price was charged: the initial grant, and again on every
// renewal (an admin re-submitting the grant form for an already-active plan,
// or the user paying their own renewal from the pricing page). Admin-entered
// rows are internal-record-only (no GST invoice — a manually negotiated deal,
// not a self-serve purchase) and leave gstPaise/totalPaise/gstin null.
// Self-serve renewal rows go through real Razorpay money movement
// (status/razorpay* columns) and, like every other purchasable pack, charge
// pricePaise + 18% GST — gstPaise/totalPaise record that breakdown and
// razorpayOrderId is created for totalPaise, not the bare pricePaise.
export const unlimitedPlanCharges = pgTable('unlimited_plan_charges', {
  id: uuid('id').primaryKey().defaultRandom(),
  unlimitedPlanId: uuid('unlimited_plan_id')
    .notNull()
    .references(() => unlimitedPlans.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  // The negotiated base price (excl. GST) — what the admin set, and what
  // persists as the base for the *next* renewal too. GST is always computed
  // fresh at charge time, never stored back into this column.
  pricePaise: integer('price_paise').notNull(),
  gstPaise: integer('gst_paise'),
  totalPaise: integer('total_paise'),
  // Optional — captured at order-creation time, same convention as
  // payments.gstin (pre-filled from the profile value, editable per charge).
  gstin: text('gstin'),
  chargeType: text('charge_type').notNull(), // 'initial' | 'renewal'
  // The users.id of whoever authorized this charge — an admin for
  // admin-entered rows, or the paying user themselves for a self-serve
  // Razorpay renewal (chargedBy === userId in that case).
  chargedBy: uuid('charged_by')
    .notNull()
    .references(() => users.id),
  // 'recorded' (admin manual entry, default — no real money movement here) |
  // 'pending' (Razorpay order created, awaiting payment) | 'paid' | 'failed'.
  status: text('status').notNull().default('recorded'),
  razorpayOrderId: text('razorpay_order_id').unique(),
  razorpayPaymentId: text('razorpay_payment_id'),
  razorpaySignature: text('razorpay_signature'),
  chargedAt: timestamp('charged_at', { withTimezone: true }).notNull().defaultNow(),
});

export const creditLedger = pgTable('credit_ledger', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  delta: integer('delta').notNull(),
  reason: text('reason').notNull(),
  jobId: uuid('job_id'),
  adminId: uuid('admin_id'),
  // Idempotency key for non-job-triggered grants (e.g. a Shopify subscription
  // billing-cycle grant). Mirrors the (job_id, reason) partial unique index
  // pattern below for job-triggered ones — see migration 0074 for that one,
  // and this task's migration for this one.
  externalRef: text('external_ref'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const creditRequests = pgTable('credit_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  creditsRequested: integer('credits_requested').notNull(),
  creditsApproved: integer('credits_approved'),
  note: text('note'),
  status: text('status').notNull().default('pending'),
  adminNote: text('admin_note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  reviewedBy: uuid('reviewed_by'),
});

// One row per payment that successfully issued a GST invoice. The unique
// paymentId is what makes issueInvoiceIfNeeded's insert idempotent under
// the verify+webhook race — a second concurrent attempt just no-ops.
export const invoices = pgTable('invoices', {
  id: uuid('id').primaryKey().defaultRandom(),
  paymentId: uuid('payment_id')
    .notNull()
    .unique()
    .references(() => payments.id, { onDelete: 'cascade' }),
  invoiceNumber: text('invoice_number').notNull().unique(),
  r2Key: text('r2_key').notNull(),
  issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
});

// One row per Indian financial year (Apr 1 - Mar 31), e.g. "2026-27".
// nextNumber is incremented transactionally (single upsert statement) so
// invoice numbers stay gap-free and race-safe under concurrent purchases.
export const invoiceSequences = pgTable('invoice_sequences', {
  financialYear: text('financial_year').primaryKey(),
  nextNumber: integer('next_number').notNull().default(1),
});
