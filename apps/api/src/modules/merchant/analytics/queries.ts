import type { DB } from '@aivastra/db';
import { type AnalyticsBreakdownBy, JOB_REFUND_REASONS } from '@aivastra/types';
import { type SQL, sql } from 'drizzle-orm';
import type { AnalyticsWindow } from './params.js';
import type { AnalyticsScope } from './scope.js';

// Aggregates computed straight from instore_sessions / session_items / jobs (no rollups,
// per the 3c spec). Every value below reaches Postgres as a bound parameter; the only
// literal SQL is fixed identifiers. Every query carries merchant_id = scope.merchantId.
//
// Metric definitions (binding, plan "Global Constraints"):
// - sessions / tried / sold / wishlisted are counted by the SESSION's started_at, so an
//   item recorded after midnight still belongs to the day its visit started;
// - sold excludes voided sales;
// - credits use jobs.created_at; in-store = session_id set, legacy = session_id null;
//   both are NET of refunds (see NOT_REFUNDED).
//
// Staff filter reading: a session belongs to the staff member who started it
// (instore_sessions.staff_id, assisted mode); a tried/sold item belongs to
// session_items.staff_id — the staff member who sold it, or who ran the try-on. The device
// records wishlists without a staff id, so a wishlist belongs to the item's staff if set,
// else to the staff member assisting the session (ITEM_STAFF). Kiosk sessions carry no
// staff id, so their sessions, try-ons and wishlists are attributed to nobody. Jobs are
// filtered by jobs.staff_id.

function n(v: unknown): number {
  // count()/sum() come back as bigint strings from postgres-js.
  return v === null || v === undefined ? 0 : Number(v);
}

// postgres-js (prepare: false) cannot serialise a Date bound through drizzle's sql
// template; send the instant as ISO text with an explicit cast.
function iso(d: Date): SQL {
  return sql`${d.toISOString()}::timestamptz`;
}

/**
 * The staff member an item counts towards. tried/sold: session_items.staff_id only (a sale
 * is the seller's even in a colleague's session). wishlisted: the device writes no item
 * staff id, so fall back to the session's assisting staff member (controller ruling B1).
 */
const ITEM_STAFF = sql`(case when i.action = 'wishlisted' then coalesce(i.staff_id, s.staff_id) else i.staff_id end)`;

/**
 * Credits are net of refunds. jobs.credits_charged is never zeroed when a job is refunded;
 * every refund path (dispatcher settlement, saree sweeper, API cancel, refund requests)
 * instead writes a credit_ledger row keyed by job_id with one of JOB_REFUND_REASONS, for
 * the full credits_charged (unique per (job_id, reason), credit_ledger_job_reason_uniq).
 * A job with any such row contributes nothing; a failed job that was never refunded still
 * counts, because its credits really were spent.
 */
const NOT_REFUNDED = sql`not exists (
  select 1 from credit_ledger l
  where l.job_id = j.id
    and l.reason in (${sql.join(
      JOB_REFUND_REASONS.map((r) => sql`${r}`),
      sql`, `,
    )})
)`;

function sessionFilters(scope: AnalyticsScope): SQL {
  const parts: SQL[] = [];
  if (scope.branchId !== undefined) parts.push(sql`and s.branch_id = ${scope.branchId}`);
  if (scope.deviceId !== undefined) parts.push(sql`and s.device_id = ${scope.deviceId}`);
  return sql.join(parts, sql` `);
}

/** Sessions of this merchant started in the window, narrowed by the branch/device filters. */
function sessionsInWindow(scope: AnalyticsScope, w: AnalyticsWindow): SQL {
  return sql`s.merchant_id = ${scope.merchantId}
    and s.started_at >= ${iso(w.startUtc)} and s.started_at < ${iso(w.endUtc)}
    ${sessionFilters(scope)}`;
}

/** staffId filter for sessions: the staff member who started (assisted) the session. */
function sessionStaffFilter(scope: AnalyticsScope): SQL {
  return scope.staffId !== undefined ? sql`and s.staff_id = ${scope.staffId}` : sql``;
}

/** staffId filter for items, by ITEM_STAFF. */
function itemStaffFilter(scope: AnalyticsScope): SQL {
  return scope.staffId !== undefined ? sql`and ${ITEM_STAFF} = ${scope.staffId}` : sql``;
}

export interface SessionTotals {
  sessions: number;
  mineSessions: number;
}

export async function sessionTotals(
  db: DB,
  scope: AnalyticsScope,
  w: AnalyticsWindow,
): Promise<SessionTotals> {
  const staffFilter = sessionStaffFilter(scope);
  const mine =
    scope.memberStaffId !== null
      ? sql`count(*) filter (where s.staff_id = ${scope.memberStaffId})`
      : sql`0`;
  const rows = await db.execute<{ sessions: string; mine: string }>(sql`
    select count(*) as sessions, ${mine} as mine
    from instore_sessions s
    where s.merchant_id = ${scope.merchantId}
      and s.started_at >= ${iso(w.startUtc)} and s.started_at < ${iso(w.endUtc)}
      ${sessionFilters(scope)} ${staffFilter}
  `);
  return { sessions: n(rows[0]?.sessions), mineSessions: n(rows[0]?.mine) };
}

export interface ItemTotals {
  tried: number;
  sold: number;
  wishlisted: number;
  mineTried: number;
  mineSold: number;
}

export async function itemTotals(
  db: DB,
  scope: AnalyticsScope,
  w: AnalyticsWindow,
): Promise<ItemTotals> {
  const staffFilter = itemStaffFilter(scope);
  const me = scope.memberStaffId;
  const mineTried =
    me !== null ? sql`count(*) filter (where i.action = 'tried' and i.staff_id = ${me})` : sql`0`;
  const mineSold =
    me !== null
      ? sql`count(*) filter (where i.action = 'sold' and i.voided_at is null and i.staff_id = ${me})`
      : sql`0`;
  const rows = await db.execute<Record<string, string>>(sql`
    select
      count(*) filter (where i.action = 'tried') as tried,
      count(*) filter (where i.action = 'sold' and i.voided_at is null) as sold,
      count(*) filter (where i.action = 'wishlisted') as wishlisted,
      ${mineTried} as mine_tried,
      ${mineSold} as mine_sold
    from session_items i
    join instore_sessions s on s.id = i.session_id
    where s.merchant_id = ${scope.merchantId}
      and s.started_at >= ${iso(w.startUtc)} and s.started_at < ${iso(w.endUtc)}
      ${sessionFilters(scope)} ${staffFilter}
  `);
  const r = rows[0] ?? {};
  return {
    tried: n(r.tried),
    sold: n(r.sold),
    wishlisted: n(r.wishlisted),
    mineTried: n(r.mine_tried),
    mineSold: n(r.mine_sold),
  };
}

export interface CreditTotals {
  /** SUM(credits_charged) over session-attributed jobs. */
  spent: number;
  /** Jobs with no session (legacy kiosk / Studio-style). */
  legacyJobs: number;
  legacyCredits: number;
}

export async function creditTotals(
  db: DB,
  scope: AnalyticsScope,
  w: AnalyticsWindow,
): Promise<CreditTotals> {
  // The legacy ("Legacy kiosk / other") line is a whole-merchant figure: it is 0 whenever
  // ANY filter is set. Not because such jobs never carry attribution — jobs.session_id is
  // ON DELETE SET NULL, so a job whose session was deleted can keep its branch/device/staff
  // ids with a null session — but because a narrowed view must not show part of a line
  // that is defined as "attributed to no session".
  const filtered =
    scope.branchId !== undefined || scope.deviceId !== undefined || scope.staffId !== undefined;
  const legacy = filtered ? sql`false` : sql`j.session_id is null`;
  // Refunded jobs drop out of the job count too: the line is "jobs that were charged".
  const rows = await db.execute<Record<string, string>>(sql`
    select
      coalesce(sum(j.credits_charged) filter (where j.session_id is not null), 0) as spent,
      count(*) filter (where ${legacy}) as legacy_jobs,
      coalesce(sum(j.credits_charged) filter (where ${legacy}), 0) as legacy_credits
    from jobs j
    where j.merchant_id = ${scope.merchantId}
      and j.created_at >= ${iso(w.startUtc)} and j.created_at < ${iso(w.endUtc)}
      and ${NOT_REFUNDED}
      ${jobFilters(scope)}
  `);
  const r = rows[0] ?? {};
  return {
    spent: n(r.spent),
    legacyJobs: n(r.legacy_jobs),
    legacyCredits: n(r.legacy_credits),
  };
}

/** The branch/device/staff filters, applied to jobs through their own attribution columns. */
function jobFilters(scope: AnalyticsScope): SQL {
  const parts: SQL[] = [];
  if (scope.branchId !== undefined) parts.push(sql`and j.branch_id = ${scope.branchId}`);
  if (scope.deviceId !== undefined) parts.push(sql`and j.device_id = ${scope.deviceId}`);
  if (scope.staffId !== undefined) parts.push(sql`and j.staff_id = ${scope.staffId}`);
  return sql.join(parts, sql` `);
}

export interface DailyPoint {
  date: string;
  sessions: number;
  tried: number;
  sold: number;
}

/**
 * One point per local day of the window, ascending, zero-filled. Days come from an integer
 * generate_series over the local calendar dates (date + n, so a DST day is still exactly
 * one row); activity is keyed by date_trunc('day', started_at AT TIME ZONE tz) with tz
 * bound as a parameter. The window bounds themselves are the UTC instants from
 * parseWindow, so every bucketed row falls on one of the generated days.
 *
 * Shape matters for the planner: sessions and items are pre-aggregated into ONE per-day
 * set before the single left join. With two left joins (and a timestamp generate_series,
 * estimated at 1000 rows) Postgres estimated ~61M rows for a 366-day window, crossed the
 * JIT thresholds and spent ~0.8 s compiling a query that runs in ~0.2 s (EXPLAIN on a
 * 500k-session dataset, Task 3 report).
 */
export async function dailyPoints(
  db: DB,
  scope: AnalyticsScope,
  w: AnalyticsWindow,
): Promise<DailyPoint[]> {
  const day = sql`date_trunc('day', s.started_at at time zone ${w.tz})::date`;
  const inWindow = sessionsInWindow(scope, w);
  const rows = await db.execute<Record<string, string>>(sql`
    with days as (
      select ${w.from}::date + g as day
      from generate_series(0, ${w.to}::date - ${w.from}::date) as g
    ),
    facts as (
      select ${day} as day, count(*) as sessions, 0::bigint as tried, 0::bigint as sold
      from instore_sessions s
      where ${inWindow} ${sessionStaffFilter(scope)}
      group by 1
      union all
      select ${day} as day, 0::bigint as sessions,
        count(*) filter (where i.action = 'tried') as tried,
        count(*) filter (where i.action = 'sold' and i.voided_at is null) as sold
      from session_items i
      join instore_sessions s on s.id = i.session_id
      where ${inWindow} and i.action in ('tried', 'sold') ${itemStaffFilter(scope)}
      group by 1
    ),
    per_day as (
      select day, sum(sessions) as sessions, sum(tried) as tried, sum(sold) as sold
      from facts
      group by day
    )
    select to_char(days.day, 'YYYY-MM-DD') as date,
      coalesce(per_day.sessions, 0) as sessions,
      coalesce(per_day.tried, 0) as tried,
      coalesce(per_day.sold, 0) as sold
    from days
    left join per_day on per_day.day = days.day
    order by days.day
  `);
  return rows.map((r) => ({
    date: String(r.date),
    sessions: n(r.sessions),
    tried: n(r.tried),
    sold: n(r.sold),
  }));
}

export interface BreakdownRow {
  id: string;
  name: string;
  sessions: number;
  tried: number;
  sold: number;
  wishlisted: number;
  creditsSpent: number;
}

/**
 * Per-entity figures. Which column a fact is attributed by:
 *   by=branch / by=device — the SESSION's branch_id / device_id for sessions and items,
 *     jobs.branch_id / device_id for credits (consistent with the summary filters);
 *   by=staff — instore_sessions.staff_id for sessions, ITEM_STAFF for items,
 *     jobs.staff_id for credits.
 * Facts with no value for the key (kiosk sessions under by=staff) belong to no row.
 *
 * Rows: every ACTIVE entity in scope (zeros included), plus any inactive one with activity
 * in the window — so a deactivated branch's history stays visible without listing every
 * dead row. Staff and devices also count as inactive when their branch is. A staff caller
 * is further restricted to their own row (by=staff), their branch (by=branch) or their
 * branch's devices (by=device), whatever the activity says.
 */
export async function breakdownRows(
  db: DB,
  scope: AnalyticsScope,
  w: AnalyticsWindow,
  by: AnalyticsBreakdownBy,
): Promise<BreakdownRow[]> {
  const m = scope.merchantId;
  const entities = {
    branch: sql`select b.id, b.name, b.is_active as active, b.id as branch_id
      from merchant_branches b where b.merchant_id = ${m}`,
    staff: sql`select ms.id, coalesce(nullif(u.display_name, ''), u.email) as name,
        (ms.is_active and b.is_active) as active, ms.branch_id
      from merchant_staff ms
      join users u on u.id = ms.user_id
      join merchant_branches b on b.id = ms.branch_id
      where ms.merchant_id = ${m}`,
    device: sql`select d.id, d.name, (d.is_active and b.is_active) as active, d.branch_id
      from merchant_devices d
      join merchant_branches b on b.id = d.branch_id
      where d.merchant_id = ${m}`,
  }[by];
  const sessionKey = { branch: sql`s.branch_id`, staff: sql`s.staff_id`, device: sql`s.device_id` }[
    by
  ];
  const itemKey = { branch: sql`s.branch_id`, staff: ITEM_STAFF, device: sql`s.device_id` }[by];
  const jobKey = { branch: sql`j.branch_id`, staff: sql`j.staff_id`, device: sql`j.device_id` }[by];

  // Zero rows are listed only for active entities matching the filters on their own columns.
  const inScope: SQL[] = [sql`e.active`];
  if (scope.branchId !== undefined) inScope.push(sql`e.branch_id = ${scope.branchId}`);
  if (by === 'staff' && scope.staffId !== undefined) inScope.push(sql`e.id = ${scope.staffId}`);
  if (by === 'device' && scope.deviceId !== undefined) {
    inScope.push(sql`e.id = ${scope.deviceId}`);
  }

  let staffOnly = sql``;
  if (scope.isStaff) {
    staffOnly =
      by === 'staff'
        ? sql`and e.id = ${scope.memberStaffId}`
        : by === 'branch'
          ? sql`and e.id = ${scope.branchId}`
          : sql`and e.branch_id = ${scope.branchId}`;
  }

  const inWindow = sessionsInWindow(scope, w);
  const sessionStaff = sessionStaffFilter(scope);
  const itemStaff = itemStaffFilter(scope);

  const rows = await db.execute<Record<string, string>>(sql`
    with e as (${entities}),
    se as (
      select ${sessionKey} as k, count(*) as sessions
      from instore_sessions s
      where ${inWindow} ${sessionStaff}
      group by 1
    ),
    it as (
      select ${itemKey} as k,
        count(*) filter (where i.action = 'tried') as tried,
        count(*) filter (where i.action = 'sold' and i.voided_at is null) as sold,
        count(*) filter (where i.action = 'wishlisted') as wishlisted
      from session_items i
      join instore_sessions s on s.id = i.session_id
      where ${inWindow} ${itemStaff}
      group by 1
    ),
    cr as (
      select ${jobKey} as k, sum(j.credits_charged) as spent
      from jobs j
      where j.merchant_id = ${m}
        and j.created_at >= ${iso(w.startUtc)} and j.created_at < ${iso(w.endUtc)}
        and j.session_id is not null
        and ${NOT_REFUNDED}
        ${jobFilters(scope)}
      group by 1
    )
    select e.id, e.name,
      coalesce(se.sessions, 0) as sessions,
      coalesce(it.tried, 0) as tried,
      coalesce(it.sold, 0) as sold,
      coalesce(it.wishlisted, 0) as wishlisted,
      coalesce(cr.spent, 0) as spent
    from e
    left join se on se.k = e.id
    left join it on it.k = e.id
    left join cr on cr.k = e.id
    where (
      (${sql.join(inScope, sql` and `)})
      or coalesce(se.sessions, 0) + coalesce(it.tried, 0) + coalesce(it.sold, 0)
        + coalesce(it.wishlisted, 0) + coalesce(cr.spent, 0) > 0
    ) ${staffOnly}
    order by e.name, e.id
  `);
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    sessions: n(r.sessions),
    tried: n(r.tried),
    sold: n(r.sold),
    wishlisted: n(r.wishlisted),
    creditsSpent: n(r.spent),
  }));
}

/** The merchant OWNER's wallet (merchant spend draws from the owner's user_credits). */
export async function ownerBalance(db: DB, merchantId: string): Promise<number> {
  const rows = await db.execute<{ balance: number | null }>(sql`
    select uc.balance
    from merchants m
    join user_credits uc on uc.user_id = m.user_id
    where m.id = ${merchantId}
  `);
  return n(rows[0]?.balance);
}

/** sold ÷ sessions, 0 when there are no sessions (never NaN/Infinity). */
export function conversionRatio(sold: number, sessions: number): number {
  return sessions > 0 ? sold / sessions : 0;
}
