import type { DB } from '@aivastra/db';
import { schema } from '@aivastra/db';
import { JOB_SOURCE, type MerchantAnalyticsResponse } from '@aivastra/types';
import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';

export interface Counted {
  name: string;
  tryOns: number;
}

/** Stable ordering: most tried first, ties by name so reloads never reshuffle. */
export function rankCounted<T extends Counted>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.tryOns - a.tryOns || a.name.localeCompare(b.name));
}

export function foldCategories(rows: Counted[], max = 6): Array<Counted & { pct: number }> {
  const ranked = rankCounted(rows);
  const total = ranked.reduce((n, r) => n + r.tryOns, 0);
  if (total === 0) return [];
  const kept = ranked.slice(0, max);
  const rest = ranked.slice(max);
  if (rest.length > 0) {
    kept.push({ name: 'Other', tryOns: rest.reduce((n, r) => n + r.tryOns, 0) });
  }
  return kept.map((r) => ({ ...r, pct: Math.round((r.tryOns / total) * 1000) / 10 }));
}

const RANGE_DAYS = { '7d': 7, '30d': 30, '90d': 90 } as const;
const DAY_MS = 86_400_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ResolvedItem {
  name: string;
  category: string;
  garmentType: string | null;
}

async function resolveItems(
  db: DB,
  merchantId: string,
  ids: string[],
): Promise<Map<string, ResolvedItem>> {
  const out = new Map<string, ResolvedItem>();
  if (ids.length === 0) return out;

  // Scoped to the merchant: an id in a job's params is never trusted to name
  // another tenant's row.
  const own = await db
    .select({
      id: schema.merchantCatalogItems.id,
      name: schema.merchantCatalogItems.label,
      category: schema.merchantCatalogSubcategories.name,
      garmentType: schema.garmentSubcategories.label,
    })
    .from(schema.merchantCatalogItems)
    .innerJoin(
      schema.merchantCatalogSubcategories,
      eq(schema.merchantCatalogSubcategories.id, schema.merchantCatalogItems.subcategoryId),
    )
    .leftJoin(
      schema.garmentSubcategories,
      eq(schema.garmentSubcategories.id, schema.merchantCatalogSubcategories.garmentSubcategoryId),
    )
    .where(
      and(
        eq(schema.merchantCatalogItems.merchantId, merchantId),
        inArray(schema.merchantCatalogItems.id, ids),
      ),
    );
  for (const r of own) out.set(r.id, r);

  // Admin demo items share the id namespace (see resolve-tryon-garment.ts).
  const rest = ids.filter((id) => !out.has(id));
  if (rest.length > 0) {
    const demo = await db
      .select({
        id: schema.demoCatalogItems.id,
        name: schema.demoCatalogItems.label,
        category: schema.demoCatalogSubcategories.name,
        garmentType: schema.garmentSubcategories.label,
      })
      .from(schema.demoCatalogItems)
      .innerJoin(
        schema.demoCatalogSubcategories,
        eq(schema.demoCatalogSubcategories.id, schema.demoCatalogItems.subcategoryId),
      )
      .leftJoin(
        schema.garmentSubcategories,
        eq(schema.garmentSubcategories.id, schema.demoCatalogSubcategories.garmentSubcategoryId),
      )
      .where(inArray(schema.demoCatalogItems.id, rest));
    for (const r of demo) out.set(r.id, r);
  }
  return out;
}

const sumBy = (rows: Array<{ key: string | null; tryOns: number }>): Counted[] => {
  const m = new Map<string, number>();
  for (const r of rows) if (r.key) m.set(r.key, (m.get(r.key) ?? 0) + r.tryOns);
  return [...m].map(([name, tryOns]) => ({ name, tryOns }));
};

export async function merchantAnalytics(
  db: DB,
  merchantId: string,
  rangeKey: keyof typeof RANGE_DAYS,
  now: Date,
): Promise<MerchantAnalyticsResponse> {
  const span = RANGE_DAYS[rangeKey] * DAY_MS;
  const to = now;
  const from = new Date(to.getTime() - span);
  const previousFrom = new Date(from.getTime() - span);

  const base = and(
    eq(schema.jobs.merchantId, merchantId),
    eq(schema.jobs.source, JOB_SOURCE.MERCHANT_TRYON),
    eq(schema.jobs.status, 'COMPLETED'),
  );
  const itemId = sql<string | null>`${schema.jobInputs.params}->>'merchantCatalogItemId'`;

  const countIn = async (a: Date, b: Date) => {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.jobs)
      .where(and(base, gte(schema.jobs.createdAt, a), lt(schema.jobs.createdAt, b)));
    return row.n;
  };
  const [totalTryOns, previousTryOns] = await Promise.all([
    countIn(from, to),
    countIn(previousFrom, from),
  ]);

  // jobs is narrowed by (merchant_id, created_at) first; the params extraction
  // only runs on that set — same pattern as shopify/analytics.ts.
  const grouped = await db
    .select({ itemId, tryOns: sql<number>`count(*)::int` })
    .from(schema.jobs)
    .innerJoin(schema.jobInputs, eq(schema.jobInputs.jobId, schema.jobs.id))
    .where(
      and(
        base,
        gte(schema.jobs.createdAt, from),
        lt(schema.jobs.createdAt, to),
        sql`${itemId} is not null`,
      ),
    )
    .groupBy(sql`1`);

  // Single-step jobs only: the two-step saree path (mannequinJobId) already
  // recorded merchantCatalogItemId before this feature, so including it would
  // pull the "covers try-ons since" date back to a time the breakdown did not
  // actually cover every product.
  const [since] = await db
    .select({ at: sql<Date | null>`min(${schema.jobs.createdAt})` })
    .from(schema.jobs)
    .innerJoin(schema.jobInputs, eq(schema.jobInputs.jobId, schema.jobs.id))
    .where(
      and(
        base,
        sql`${itemId} is not null`,
        sql`NOT (${schema.jobInputs.params} ? 'mannequinJobId')`,
      ),
    );

  // params is free-form JSON: a malformed id must not reach the uuid cast in
  // resolveItems and 500 the dashboard. It still counts in totals above.
  const resolved = await resolveItems(
    db,
    merchantId,
    grouped.map((g) => g.itemId as string).filter((id) => UUID_RE.test(id)),
  );

  // An item deleted since the try-on no longer resolves; it is left out of
  // every breakdown rather than shown under a made-up name.
  const rows = grouped
    .map((g) => ({ ...g, item: resolved.get(g.itemId as string) }))
    .filter((g): g is typeof g & { item: ResolvedItem } => g.item !== undefined);

  const products = rankCounted(
    rows.map((r) => ({ name: r.item.name, tryOns: r.tryOns, itemId: r.itemId as string })),
  );
  const garmentTypes = rankCounted(
    sumBy(rows.map((r) => ({ key: r.item.garmentType, tryOns: r.tryOns }))),
  );

  return {
    range: {
      from: from.toISOString(),
      to: to.toISOString(),
      previousFrom: previousFrom.toISOString(),
    },
    totalTryOns,
    previousTryOns,
    breakdownSince: since?.at ? new Date(since.at).toISOString() : null,
    topGarmentType: garmentTypes[0] ?? null,
    mostTriedProduct: products[0] ? { name: products[0].name, tryOns: products[0].tryOns } : null,
    leastTriedProduct:
      products.length > 1
        ? {
            name: products[products.length - 1].name,
            tryOns: products[products.length - 1].tryOns,
          }
        : null,
    categories: foldCategories(
      sumBy(rows.map((r) => ({ key: r.item.category, tryOns: r.tryOns }))),
    ),
    topProducts: products.slice(0, 10).map((p, i) => ({ rank: i + 1, ...p })),
  };
}
