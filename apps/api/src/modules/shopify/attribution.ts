import type { DB } from '@aivastra/db';
import { schema } from '@aivastra/db';
import { and, desc, eq, gte, inArray, lte, or, sql } from 'drizzle-orm';
import { normalizeEmail } from './shopper.js';

/** How long after a completed try-on an order still counts as influenced by it. */
export const ATTRIBUTION_WINDOW_DAYS = 7;

/** The slice of Shopify's orders/paid payload attribution reads. Every field is
 *  optional: without Protected Customer Data approval Shopify strips the
 *  customer fields, and an order we cannot identify is simply not attributed. */
export interface OrderPaidPayload {
  id?: number;
  processed_at?: string | null;
  created_at?: string | null;
  currency?: string;
  email?: string | null;
  customer?: { id?: number; email?: string | null } | null;
  line_items?: {
    product_id?: number | null;
    price?: string;
    quantity?: number;
    total_discount?: string;
  }[];
}

/** Net value per product across the order's line items, in minor units, so the
 *  sum is exact. Shopify sends prices as decimal strings. */
export function lineValueByProduct(items: OrderPaidPayload['line_items']): Map<number, number> {
  const byProduct = new Map<number, number>();
  for (const li of items ?? []) {
    if (!li.product_id) continue;
    const gross = Math.round(Number(li.price ?? 0) * 100) * (li.quantity ?? 0);
    const net = Math.max(0, gross - Math.round(Number(li.total_discount ?? 0) * 100));
    byProduct.set(li.product_id, (byProduct.get(li.product_id) ?? 0) + net);
  }
  return byProduct;
}

/**
 * Credit a paid order to try-ons: the order's buyer is a known shopper (Shopify
 * customer id, else email) who completed a try-on of one of the ordered
 * products within ATTRIBUTION_WINDOW_DAYS before the order. Revenue is the
 * value of just those matching line items. Idempotent on (store, order).
 *
 * Returns true when a row was written.
 */
export async function attributeOrder(
  db: DB,
  storeId: string,
  order: OrderPaidPayload,
): Promise<boolean> {
  if (!order.id || !order.currency) return false;
  const orderedAt = new Date(order.processed_at ?? order.created_at ?? Date.now());
  const values = lineValueByProduct(order.line_items);
  if (values.size === 0) return false;

  const s = schema.shopifyShoppers;
  const email = normalizeEmail(order.customer?.email ?? order.email);
  const who = [
    order.customer?.id ? eq(s.shopifyCustomerId, order.customer.id) : undefined,
    email ? eq(sql`lower(${s.email})`, email) : undefined,
  ].filter((c) => c !== undefined);
  if (who.length === 0) return false;

  const productId = sql<number>`(${schema.jobInputs.params}->>'shopifyProductId')::bigint`;
  const windowStart = new Date(orderedAt.getTime() - ATTRIBUTION_WINDOW_DAYS * 86_400_000);

  const tried = await db
    .select({ productId, shopperId: schema.jobs.shopifyShopperId })
    .from(schema.jobs)
    .innerJoin(s, eq(s.id, schema.jobs.shopifyShopperId))
    .innerJoin(schema.jobInputs, eq(schema.jobInputs.jobId, schema.jobs.id))
    .where(
      and(
        eq(s.storeId, storeId),
        or(...who),
        eq(schema.jobs.status, 'COMPLETED'),
        gte(schema.jobs.createdAt, windowStart),
        lte(schema.jobs.createdAt, orderedAt),
        inArray(
          sql`(${schema.jobInputs.params}->>'shopifyProductId')`,
          [...values.keys()].map(String),
        ),
      ),
    )
    .orderBy(desc(schema.jobs.createdAt));

  const matched = new Set(tried.map((r) => Number(r.productId)));
  let cents = 0;
  for (const [pid, value] of values) if (matched.has(pid)) cents += value;
  if (cents === 0) return false;

  const inserted = await db
    .insert(schema.shopifyAttributedOrders)
    .values({
      storeId,
      shopifyOrderId: order.id,
      shopperId: tried[0]?.shopperId ?? null,
      currency: order.currency,
      revenue: (cents / 100).toFixed(2),
      orderedAt,
    })
    .onConflictDoNothing()
    .returning({ id: schema.shopifyAttributedOrders.id });
  return inserted.length > 0;
}
