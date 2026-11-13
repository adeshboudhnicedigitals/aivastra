import type { DB } from '@aivastra/db';
import type {
  AnalyticsHeatmapCell,
  AnalyticsHeatmapMetric,
  AnalyticsServerEvent,
} from '@aivastra/types';
import { type SQL, sql } from 'drizzle-orm';
import type { AnalyticsWindow } from './params.js';
import type { AnalyticsScope } from './scope.js';

// Analytics phase 1, plan Task 6: the first reader of analytics_buckets. Unlike queries.ts
// (counted by the SESSION's start), a heatmap cell counts the event at the moment it
// happened, which is what "when is the store busy" means.
//
// Buckets are 15-minute UTC (plan D3), so every bucket falls wholly inside one local hour for
// any real offset, and the window bounds (local midnights) are bucket edges too.

const METRIC_EVENT: Record<AnalyticsHeatmapMetric, AnalyticsServerEvent> = {
  sessions: 'session_started',
  tryons: 'tryon_requested',
};

function iso(d: Date): SQL {
  // Same postgres-js Date-binding workaround as queries.ts.
  return sql`${d.toISOString()}::timestamptz`;
}

function bucketFilters(scope: AnalyticsScope): SQL {
  const parts: SQL[] = [];
  if (scope.branchId !== undefined) parts.push(sql`and b.branch_id = ${scope.branchId}`);
  if (scope.deviceId !== undefined) parts.push(sql`and b.device_id = ${scope.deviceId}`);
  if (scope.staffId !== undefined) parts.push(sql`and b.staff_id = ${scope.staffId}`);
  return sql.join(parts, sql` `);
}

/** 168 cells (weekday 0 = Sunday … 6, hour 0–23 in the window's tz), zero-filled. */
export async function heatmapCells(
  db: DB,
  scope: AnalyticsScope,
  w: AnalyticsWindow,
  metric: AnalyticsHeatmapMetric,
): Promise<AnalyticsHeatmapCell[]> {
  const local = sql`(b.bucket_start at time zone ${w.tz})`;
  const rows = await db.execute<{ dow: number; hour: number; value: string }>(sql`
    select extract(dow from ${local})::int as dow, extract(hour from ${local})::int as hour,
      sum(b.count) as value
    from analytics_buckets b
    where b.merchant_id = ${scope.merchantId}
      and b.event = ${METRIC_EVENT[metric]}
      and b.bucket_start >= ${iso(w.startUtc)} and b.bucket_start < ${iso(w.endUtc)}
      ${bucketFilters(scope)}
    group by 1, 2
  `);
  const grid = new Map(rows.map((r) => [r.dow * 24 + r.hour, Number(r.value)]));
  return Array.from({ length: 168 }, (_, i) => ({
    weekday: Math.floor(i / 24),
    hour: i % 24,
    value: grid.get(i) ?? 0,
  }));
}
