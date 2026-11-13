import type {
  AnalyticsBreakdownBy,
  AnalyticsBreakdownResponse,
  AnalyticsHeatmapMetric,
  AnalyticsHeatmapResponse,
  AnalyticsSummaryResponse,
  AnalyticsTimeseriesResponse,
} from '@aivastra/types';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './api';

/** Dates in the merchant dashboards are local dates in this zone (spec: no per-merchant tz). */
export const ANALYTICS_TZ = 'Asia/Kolkata';

export type AnalyticsRange = { from: string; to: string };

function qs(range: AnalyticsRange, extra: Record<string, string | undefined> = {}): string {
  const p = new URLSearchParams({ from: range.from, to: range.to, tz: ANALYTICS_TZ });
  for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
  return p.toString();
}

export const fetchSummary = (range: AnalyticsRange, branchId?: string) =>
  apiFetch<AnalyticsSummaryResponse>(`/v1/merchant/analytics/summary?${qs(range, { branchId })}`);

export const fetchTimeseries = (range: AnalyticsRange, branchId?: string) =>
  apiFetch<AnalyticsTimeseriesResponse>(
    `/v1/merchant/analytics/timeseries?${qs(range, { branchId })}`,
  );

export const fetchBreakdown = (
  range: AnalyticsRange,
  by: AnalyticsBreakdownBy,
  branchId?: string,
  extra: { staffId?: string; deviceId?: string } = {},
) =>
  apiFetch<AnalyticsBreakdownResponse>(
    `/v1/merchant/analytics/breakdown?${qs(range, { by, branchId, ...extra })}`,
  );

// 30s: a dashboard people glance at repeatedly; fresh enough without refetching on every
// remount. Errors are left to the caller's ListState: apiFetch already owns the 401/403 rules.
const STALE_MS = 30_000;

export function useAnalyticsSummary(range: AnalyticsRange | null, branchId?: string) {
  return useQuery({
    queryKey: ['analytics', 'summary', range?.from, range?.to, branchId ?? null],
    queryFn: () => fetchSummary(range as AnalyticsRange, branchId),
    enabled: range !== null,
    staleTime: STALE_MS,
  });
}

export function useAnalyticsTimeseries(range: AnalyticsRange | null, branchId?: string) {
  return useQuery({
    queryKey: ['analytics', 'timeseries', range?.from, range?.to, branchId ?? null],
    queryFn: () => fetchTimeseries(range as AnalyticsRange, branchId),
    enabled: range !== null,
    staleTime: STALE_MS,
  });
}

export const fetchHeatmap = (
  range: AnalyticsRange,
  metric: AnalyticsHeatmapMetric,
  branchId?: string,
) =>
  apiFetch<AnalyticsHeatmapResponse>(
    `/v1/merchant/analytics/heatmap?${qs(range, { metric, branchId })}`,
  );

export function useAnalyticsHeatmap(
  range: AnalyticsRange | null,
  metric: AnalyticsHeatmapMetric,
  branchId?: string,
) {
  return useQuery({
    queryKey: ['analytics', 'heatmap', metric, range?.from, range?.to, branchId ?? null],
    queryFn: () => fetchHeatmap(range as AnalyticsRange, metric, branchId),
    enabled: range !== null,
    staleTime: STALE_MS,
  });
}

export function useAnalyticsBreakdown(
  range: AnalyticsRange | null,
  by: AnalyticsBreakdownBy,
  enabled = true,
  branchId?: string,
  extra: { staffId?: string; deviceId?: string } = {},
) {
  return useQuery({
    queryKey: [
      'analytics',
      'breakdown',
      by,
      range?.from,
      range?.to,
      branchId ?? null,
      extra.staffId ?? null,
      extra.deviceId ?? null,
    ],
    queryFn: () => fetchBreakdown(range as AnalyticsRange, by, branchId, extra),
    enabled: enabled && range !== null,
    staleTime: STALE_MS,
  });
}
