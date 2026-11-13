import type {
  InsightsFunnelResponse,
  InsightsReliabilityResponse,
  LostDemandResponse,
  OutOfStockResponse,
} from '@aivastra/types';
import { useQuery } from '@tanstack/react-query';
import { ANALYTICS_TZ, type AnalyticsRange } from './analytics';
import { apiFetch } from './api';

function qs(range: AnalyticsRange, branchId?: string): string {
  const p = new URLSearchParams({ from: range.from, to: range.to, tz: ANALYTICS_TZ });
  if (branchId) p.set('branchId', branchId);
  return p.toString();
}

// Same 30s freshness as the dashboard; errors are left to the caller's ListState.
const STALE_MS = 30_000;

function useInsight<T>(name: string, range: AnalyticsRange | null, branchId?: string) {
  return useQuery({
    queryKey: ['insights', name, range?.from, range?.to, branchId ?? null],
    queryFn: () =>
      apiFetch<T>(`/v1/merchant/insights/${name}?${qs(range as AnalyticsRange, branchId)}`),
    enabled: range !== null,
    staleTime: STALE_MS,
  });
}

export const useInsightsFunnel = (r: AnalyticsRange | null, branchId?: string) =>
  useInsight<InsightsFunnelResponse>('funnel', r, branchId);
export const useLostDemand = (r: AnalyticsRange | null, branchId?: string) =>
  useInsight<LostDemandResponse>('lost-demand', r, branchId);
export const useOutOfStock = (r: AnalyticsRange | null, branchId?: string) =>
  useInsight<OutOfStockResponse>('out-of-stock', r, branchId);
export const useInsightsReliability = (r: AnalyticsRange | null, branchId?: string) =>
  useInsight<InsightsReliabilityResponse>('reliability', r, branchId);

/** "42%" with at most one decimal; an em dash when there is nothing to divide. */
export function pct(ratio: number | null): string {
  if (ratio === null) return '—';
  return `${Math.round(ratio * 1000) / 10}%`;
}

/** Step-to-step share, e.g. carted ÷ tried; an em dash for an empty step. */
export function stepPct(part: number, whole: number): string {
  return whole > 0 ? pct(part / whole) : '—';
}

/** 20000 → "20 s", 90000 → "1.5 min"; an em dash for no data. */
export function waitText(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 60_000) return `${Math.round(ms / 100) / 10} s`;
  return `${Math.round(ms / 6000) / 10} min`;
}

/** Credits per unit with at most one decimal; an em dash for no data. */
export function perUnit(v: number | null): string {
  return v === null ? '—' : String(Math.round(v * 10) / 10);
}
