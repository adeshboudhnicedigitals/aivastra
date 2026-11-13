import type { DB } from '@aivastra/db';
import type {
  DemandByVariant,
  InsightsFunnelResponse,
  InsightsReliabilityResponse,
  LostDemandItem,
  OutOfStockRow,
  StaleStockBranch,
} from '@aivastra/types';
import { INSIGHTS_LIST_MAX } from '@aivastra/types';
import { sql } from 'drizzle-orm';
import type { AnalyticsWindow } from '../analytics/params.js';
import { iso, NOT_REFUNDED } from '../analytics/queries.js';
import type { AnalyticsScope } from '../analytics/scope.js';

// Insights queries. Same rules as analytics/queries.ts: counted by the SESSION's started_at,
// voided sales excluded, credits net of refunds, every query carries merchant_id. They read
// source tables (plan D1), so they cannot disagree with the dashboard. Only a branch filter
// applies (staff are forced to their own branch by resolveScope); the lists are per item.

function n(v: unknown): number {
  return v === null || v === undefined ? 0 : Number(v);
}
function nOrNull(v: unknown): number | null {
  return v === null || v === undefined ? null : Number(v);
}

/** CTE `ss`: this merchant's sessions started in the window, narrowed by branch. */
function sessionsCte(scope: AnalyticsScope, w: AnalyticsWindow) {
  const branch = scope.branchId !== undefined ? sql`and s.branch_id = ${scope.branchId}` : sql``;
  return sql`ss as (
    select s.id from instore_sessions s
    where s.merchant_id = ${scope.merchantId}
      and s.started_at >= ${iso(w.startUtc)} and s.started_at < ${iso(w.endUtc)}
      ${branch}
  )`;
}

export async function funnel(
  db: DB,
  scope: AnalyticsScope,
  w: AnalyticsWindow,
): Promise<Omit<InsightsFunnelResponse, 'window'>> {
  const rows = await db.execute<Record<string, string>>(sql`
    with ${sessionsCte(scope, w)},
    live as (
      select c.id as cart_id, c.session_id, c.status, bool_or(l.billed_at is not null) as has_billed
      from carts c
      join ss on ss.id = c.session_id
      join cart_lines l on l.cart_id = c.id and l.removed_at is null
      where c.merchant_id = ${scope.merchantId}
      group by c.id, c.session_id, c.status
    )
    select
      (select count(*) from ss) as sessions,
      (select count(distinct i.session_id) from session_items i
         join ss on ss.id = i.session_id where i.action = 'tried') as tried,
      (select count(*) from live) as carted,
      (select count(*) from live where has_billed) as billed,
      (select count(*) from live where status = 'billed') as carts_billed,
      (select count(*) from live where status = 'abandoned') as carts_abandoned,
      (select count(*) from live where status = 'open') as carts_open
  `);
  const r = rows[0] ?? {};
  const billed = n(r.carts_billed);
  const abandoned = n(r.carts_abandoned);
  return {
    sessions: n(r.sessions),
    tried: n(r.tried),
    carted: n(r.carted),
    billed: n(r.billed),
    carts: { billed, abandoned, open: n(r.carts_open) },
    abandonmentRate: billed + abandoned === 0 ? null : abandoned / (billed + abandoned),
  };
}

export async function lostDemandItems(
  db: DB,
  scope: AnalyticsScope,
  w: AnalyticsWindow,
  minTries: number,
): Promise<LostDemandItem[]> {
  const rows = await db.execute<Record<string, string | null>>(sql`
    with ${sessionsCte(scope, w)},
    t as (
      select i.catalog_item_id,
        count(*) filter (where i.action = 'tried') as tried,
        count(*) filter (where i.action = 'sold' and i.voided_at is null) as sold
      from session_items i join ss on ss.id = i.session_id
      group by i.catalog_item_id
    ),
    c as (
      select l.catalog_item_id, sum(l.quantity) as carted
      from cart_lines l
      join carts ca on ca.id = l.cart_id
      join ss on ss.id = ca.session_id
      where l.merchant_id = ${scope.merchantId} and l.removed_at is null
      group by l.catalog_item_id
    )
    select t.catalog_item_id, ci.label, ci.offer_price_paise, t.tried, t.sold,
           coalesce(c.carted, 0) as carted
    from t
    left join c on c.catalog_item_id = t.catalog_item_id
    left join merchant_catalog_items ci
      on ci.id = t.catalog_item_id and ci.merchant_id = ${scope.merchantId}
    where t.tried >= ${minTries}
    order by t.tried * (1 - least(t.sold::float / t.tried, 1)) desc, t.tried desc, t.catalog_item_id
    limit ${INSIGHTS_LIST_MAX}
  `);
  return rows.map((r) => {
    const tried = n(r.tried);
    const sold = n(r.sold);
    return {
      catalogItemId: String(r.catalog_item_id),
      name: r.label ?? 'Removed item',
      pricePaise: nOrNull(r.offer_price_paise),
      tried,
      carted: n(r.carted),
      sold,
      rate: tried === 0 ? 0 : Math.min(sold / tried, 1),
    };
  });
}

export async function demandByVariant(
  db: DB,
  scope: AnalyticsScope,
  w: AnalyticsWindow,
  by: 'size' | 'colour',
): Promise<DemandByVariant[]> {
  const col = by === 'size' ? sql`v.size` : sql`v.colour`;
  const rows = await db.execute<Record<string, string>>(sql`
    with ${sessionsCte(scope, w)}
    select ${col} as label,
      sum(l.quantity) as carted,
      coalesce(sum(l.quantity) filter (where l.billed_at is not null), 0) as sold
    from cart_lines l
    join carts ca on ca.id = l.cart_id
    join ss on ss.id = ca.session_id
    join merchant_catalog_variants v on v.id = l.variant_id
    where l.merchant_id = ${scope.merchantId} and l.removed_at is null
    group by 1
    order by carted desc, label
    limit ${INSIGHTS_LIST_MAX}
  `);
  return rows.map((r) => ({ label: r.label ?? '', carted: n(r.carted), sold: n(r.sold) }));
}

export async function outOfStockRows(
  db: DB,
  scope: AnalyticsScope,
  w: AnalyticsWindow,
): Promise<OutOfStockRow[]> {
  const branch = scope.branchId !== undefined ? sql`and e.branch_id = ${scope.branchId}` : sql``;
  // props->>'variantId' is device-supplied for oos_viewed, so it is compared as text, never cast.
  const rows = await db.execute<Record<string, string | null>>(sql`
    select e.catalog_item_id, e.branch_id, b.name as branch_name,
      v.size, v.colour, ci.label,
      count(*) filter (where e.event = 'cart_refused_oos') as refused,
      count(*) filter (where e.event = 'oos_viewed') as views
    from analytics_events e
    left join merchant_catalog_variants v
      on v.id::text = e.props->>'variantId' and v.merchant_id = ${scope.merchantId}
    left join merchant_catalog_items ci
      on ci.id = e.catalog_item_id and ci.merchant_id = ${scope.merchantId}
    left join merchant_branches b
      on b.id = e.branch_id and b.merchant_id = ${scope.merchantId}
    where e.merchant_id = ${scope.merchantId}
      and e.event in ('cart_refused_oos', 'oos_viewed')
      and e.occurred_at >= ${iso(w.startUtc)} and e.occurred_at < ${iso(w.endUtc)}
      ${branch}
    group by e.catalog_item_id, e.branch_id, b.name, v.size, v.colour, ci.label
    order by refused desc, views desc, ci.label
    limit ${INSIGHTS_LIST_MAX}
  `);
  return rows.map((r) => ({
    catalogItemId: r.catalog_item_id ?? null,
    name: r.label ?? 'Removed item',
    size: r.size ?? '',
    colour: r.colour ?? '',
    branchId: r.branch_id ?? null,
    branchName: r.branch_name ?? '',
    refused: n(r.refused),
    views: n(r.views),
  }));
}

/** Branches whose manually maintained stock has not been touched in `staleDays` days. */
export async function staleStock(
  db: DB,
  scope: AnalyticsScope,
  staleDays: number,
  now: Date,
): Promise<StaleStockBranch[]> {
  const branch = scope.branchId !== undefined ? sql`and st.branch_id = ${scope.branchId}` : sql``;
  const cutoff = new Date(now.getTime() - staleDays * 86_400_000);
  const rows = await db.execute<Record<string, string>>(sql`
    select st.branch_id, b.name as branch_name, count(*) as variants,
           max(st.updated_at) as last_update
    from variant_branch_stock st
    join merchant_branches b on b.id = st.branch_id and b.merchant_id = ${scope.merchantId}
    where st.merchant_id = ${scope.merchantId} and st.source = 'manual' ${branch}
    group by st.branch_id, b.name
    having max(st.updated_at) < ${iso(cutoff)}
    order by last_update asc, b.name
  `);
  return rows.map((r) => ({
    branchId: String(r.branch_id),
    branchName: r.branch_name ?? '',
    variants: n(r.variants),
    lastUpdate: new Date(String(r.last_update)).toISOString(),
  }));
}

export async function reliability(
  db: DB,
  scope: AnalyticsScope,
  w: AnalyticsWindow,
): Promise<Omit<InsightsReliabilityResponse, 'window'>> {
  const jobBranch = scope.branchId !== undefined ? sql`and j.branch_id = ${scope.branchId}` : sql``;
  const [jobs, items] = await Promise.all([
    db.execute<Record<string, string | null>>(sql`
      select
        count(*) filter (where j.status in ('COMPLETED', 'FAILED')) as finished,
        count(*) filter (where j.status = 'FAILED') as failed,
        percentile_cont(0.5) within group (
          order by extract(epoch from (j.completed_at - j.created_at)) * 1000
        ) filter (where j.status = 'COMPLETED' and j.completed_at is not null) as p50,
        percentile_cont(0.9) within group (
          order by extract(epoch from (j.completed_at - j.created_at)) * 1000
        ) filter (where j.status = 'COMPLETED' and j.completed_at is not null) as p90,
        coalesce(sum(j.credits_charged) filter (where ${NOT_REFUNDED}), 0) as spent
      from jobs j
      where j.merchant_id = ${scope.merchantId} and j.session_id is not null
        and j.created_at >= ${iso(w.startUtc)} and j.created_at < ${iso(w.endUtc)}
        ${jobBranch}
    `),
    db.execute<Record<string, string>>(sql`
      with ${sessionsCte(scope, w)}
      select
        count(*) filter (where i.action = 'tried') as tried,
        count(*) filter (where i.action = 'sold' and i.voided_at is null) as sold
      from session_items i join ss on ss.id = i.session_id
    `),
  ]);
  const j = jobs[0] ?? {};
  const it = items[0] ?? {};
  const finished = n(j.finished);
  const failed = n(j.failed);
  const spent = n(j.spent);
  const tried = n(it.tried);
  const sold = n(it.sold);
  return {
    finished,
    failed,
    failureRate: finished === 0 ? null : failed / finished,
    waitMs: {
      p50: nOrNull(j.p50) === null ? null : Math.round(Number(j.p50)),
      p90: nOrNull(j.p90) === null ? null : Math.round(Number(j.p90)),
    },
    creditsPerTryon: tried === 0 ? null : spent / tried,
    creditsPerSale: sold === 0 ? null : spent / sold,
  };
}
