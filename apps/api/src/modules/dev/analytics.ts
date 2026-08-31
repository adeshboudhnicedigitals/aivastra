import type { DB } from '@aivastra/db';
import { schema } from '@aivastra/db';
import { JOB_SOURCE } from '@aivastra/types';
import { and, eq, gte, lt, sql } from 'drizzle-orm';

export interface DevAnalyticsRange {
  /** Inclusive UTC instant. */
  from: Date;
  /** Exclusive UTC instant. */
  to: Date;
}

const int = (expr: ReturnType<typeof sql>) => sql<number>`${expr}::int`;

export interface DevAnalyticsCards {
  tryOns: number;
  uniqueShoppers: number;
  addedToCart: number;
  addToCartRate: number;
}

/**
 * `tryOns` is real: jobs.source is set server-side at job creation
 * (createDevTryonJob) and cannot be forged by a caller, mirroring how
 * apps/api/src/modules/shopify/analytics.ts measures its own `tryOns` card
 * from the `jobs` table. `uniqueShoppers` and `addedToCart` are advisory,
 * unlike Shopify's equivalents: the WordPress dev-API's POST /v1/dev/tryon
 * carries no shopper identity at all (Shopify's does, via shopify_shoppers),
 * so there is no unforgeable join to count real shoppers by — this reads the
 * client-reported merchant_widget_events log instead.
 */
export async function devAnalyticsCards(
  db: DB,
  merchantId: string,
  range: DevAnalyticsRange,
): Promise<DevAnalyticsCards> {
  // jobs.merchantId is never set by the dev-API job creator (createDevJobCore
  // only stamps userId + apiKeyId — see the column comment in
  // packages/db/src/schema/jobs.ts). The owning merchant is reached the same
  // way GET /v1/dev/jobs/:id reaches it: through the API key that created it.
  const [jobRow] = await db
    .select({ tryOns: int(sql`count(*)`) })
    .from(schema.jobs)
    .innerJoin(schema.apiKeys, eq(schema.apiKeys.id, schema.jobs.apiKeyId))
    .where(
      and(
        eq(schema.apiKeys.merchantId, merchantId),
        eq(schema.jobs.source, JOB_SOURCE.WORDPRESS_TRYON),
        gte(schema.jobs.createdAt, range.from),
        lt(schema.jobs.createdAt, range.to),
      ),
    );

  const ev = schema.merchantWidgetEvents;
  const inEventRange = and(
    eq(ev.merchantId, merchantId),
    gte(ev.createdAt, range.from),
    lt(ev.createdAt, range.to),
  );

  const [eventRow] = await db
    .select({
      uniqueShoppers: int(sql`count(distinct ${ev.clientId})`),
      addedToCart: int(sql`count(*) filter (where ${ev.type} = 'add_to_cart')`),
    })
    .from(ev)
    .where(inEventRange);

  const tryOns = jobRow?.tryOns ?? 0;
  const addedToCart = eventRow?.addedToCart ?? 0;
  return {
    tryOns,
    uniqueShoppers: eventRow?.uniqueShoppers ?? 0,
    addedToCart,
    addToCartRate: tryOns === 0 ? 0 : addedToCart / tryOns,
  };
}

/** Real, same source as the `tryOns` card. UTC calendar days — the dev API has no per-merchant timezone concept. */
export async function devAnalyticsDaily(
  db: DB,
  merchantId: string,
  range: DevAnalyticsRange,
): Promise<{ day: string; tryOns: number }[]> {
  const rows = await db
    .select({
      day: sql<string>`to_char(${schema.jobs.createdAt}::date, 'YYYY-MM-DD')`,
      tryOns: int(sql`count(*)`),
    })
    .from(schema.jobs)
    .innerJoin(schema.apiKeys, eq(schema.apiKeys.id, schema.jobs.apiKeyId))
    .where(
      and(
        eq(schema.apiKeys.merchantId, merchantId),
        eq(schema.jobs.source, JOB_SOURCE.WORDPRESS_TRYON),
        gte(schema.jobs.createdAt, range.from),
        lt(schema.jobs.createdAt, range.to),
      ),
    )
    .groupBy(sql`1`)
    .orderBy(sql`1`);

  // Zero-fill: a quiet day must render as an empty slot, not be skipped.
  const counts = new Map(rows.map((r) => [r.day, r.tryOns]));
  const days: string[] = [];
  for (let t = range.from.getTime(); t < range.to.getTime(); t += 86_400_000) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  return days.map((day) => ({ day, tryOns: counts.get(day) ?? 0 }));
}

export interface DevAnalyticsProduct {
  productId: number;
  tryOns: number;
  uniqueShoppers: number;
  addedToCart: number;
  addToCartRate: number;
}

/**
 * Entirely advisory, unlike shopify/analytics.ts's analyticsProducts (which
 * joins real jobs to job_inputs.params->>'shopifyProductId'): the WordPress
 * dev-API's POST /v1/dev/tryon has no productId field at all, so there is no
 * real per-product try-on count to read — every number here, including
 * tryOns, comes from the client-reported merchant_widget_events log.
 */
export async function devAnalyticsProducts(
  db: DB,
  merchantId: string,
  range: DevAnalyticsRange,
): Promise<DevAnalyticsProduct[]> {
  const ev = schema.merchantWidgetEvents;
  const rows = await db
    .select({
      productId: ev.productId,
      tryOns: int(sql`count(*) filter (where ${ev.type} = 'result_view')`),
      uniqueShoppers: int(sql`count(distinct ${ev.clientId})`),
      addedToCart: int(sql`count(*) filter (where ${ev.type} = 'add_to_cart')`),
    })
    .from(ev)
    .where(
      and(
        eq(ev.merchantId, merchantId),
        gte(ev.createdAt, range.from),
        lt(ev.createdAt, range.to),
        sql`${ev.productId} is not null`,
      ),
    )
    .groupBy(ev.productId);

  return rows
    .map((r) => {
      const tryOns = r.tryOns;
      const addedToCart = r.addedToCart;
      return {
        productId: Number(r.productId),
        tryOns,
        uniqueShoppers: r.uniqueShoppers,
        addedToCart,
        addToCartRate: tryOns === 0 ? 0 : addedToCart / tryOns,
      };
    })
    .sort((a, b) => b.tryOns - a.tryOns);
}
