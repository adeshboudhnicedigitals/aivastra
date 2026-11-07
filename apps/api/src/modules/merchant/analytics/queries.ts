import type { DB } from '@aivastra/db';
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
// - credits use jobs.created_at; in-store = session_id set, legacy = session_id null.
//
// Staff filter reading: a session belongs to the staff member who started it
// (instore_sessions.staff_id, assisted mode); an item belongs to session_items.staff_id —
// the staff member who sold it, or who ran the try-on. Kiosk sessions and wishlisted items
// carry no staff id and so are never attributed to anyone, which also means a staff
// filter always reports 0 wishlisted. Jobs are filtered by jobs.staff_id.

function n(v: unknown): number {
  // count()/sum() come back as bigint strings from postgres-js.
  return v === null || v === undefined ? 0 : Number(v);
}

// postgres-js (prepare: false) cannot serialise a Date bound through drizzle's sql
// template; send the instant as ISO text with an explicit cast.
function iso(d: Date): SQL {
  return sql`${d.toISOString()}::timestamptz`;
}

function sessionFilters(scope: AnalyticsScope): SQL {
  const parts: SQL[] = [];
  if (scope.branchId !== undefined) parts.push(sql`and s.branch_id = ${scope.branchId}`);
  if (scope.deviceId !== undefined) parts.push(sql`and s.device_id = ${scope.deviceId}`);
  return sql.join(parts, sql` `);
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
  const staffFilter = scope.staffId !== undefined ? sql`and s.staff_id = ${scope.staffId}` : sql``;
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
  const staffFilter = scope.staffId !== undefined ? sql`and i.staff_id = ${scope.staffId}` : sql``;
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
  // The same branch/device/staff filters apply to jobs through their own attribution
  // columns. Legacy jobs carry none of them, so any filter zeroes the legacy line —
  // correct, since they belong to no branch, device or staff member.
  const parts: SQL[] = [];
  if (scope.branchId !== undefined) parts.push(sql`and j.branch_id = ${scope.branchId}`);
  if (scope.deviceId !== undefined) parts.push(sql`and j.device_id = ${scope.deviceId}`);
  if (scope.staffId !== undefined) parts.push(sql`and j.staff_id = ${scope.staffId}`);
  const rows = await db.execute<Record<string, string>>(sql`
    select
      coalesce(sum(j.credits_charged) filter (where j.session_id is not null), 0) as spent,
      count(*) filter (where j.session_id is null) as legacy_jobs,
      coalesce(sum(j.credits_charged) filter (where j.session_id is null), 0) as legacy_credits
    from jobs j
    where j.merchant_id = ${scope.merchantId}
      and j.created_at >= ${iso(w.startUtc)} and j.created_at < ${iso(w.endUtc)}
      ${sql.join(parts, sql` `)}
  `);
  const r = rows[0] ?? {};
  return {
    spent: n(r.spent),
    legacyJobs: n(r.legacy_jobs),
    legacyCredits: n(r.legacy_credits),
  };
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
