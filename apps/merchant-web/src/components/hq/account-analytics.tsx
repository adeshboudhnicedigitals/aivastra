'use client';
import type {
  AnalyticsBreakdownResponse,
  AnalyticsSummaryResponse,
  AnalyticsTimeseriesResponse,
} from '@aivastra/types';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { BreakdownTable } from '@/components/analytics/BreakdownTable';
import { KpiCard } from '@/components/analytics/KpiCard';
import { type PickerState, RangePicker } from '@/components/analytics/RangePicker';
import { TrendChart } from '@/components/analytics/TrendChart';
import { C } from '@/components/tokens';
import { ListState } from '@/components/ui/state';
import { ANALYTICS_TZ } from '@/lib/analytics';
import { isValidCustomRange, rangeFor } from '@/lib/date-range';
import { hqFetch } from '@/lib/hq-api';

const STALE_MS = 30_000;
const n = (v: number) => v.toLocaleString('en-IN');

// One account's dashboards for the team console (phase 2). The same components the retailer
// sees, fed from /admin/accounts/:id/analytics/* through the console's own client.
export function AccountAnalytics({ merchantId }: { merchantId: string }) {
  const [picker, setPicker] = useState<PickerState>({ choice: '30d', from: '', to: '' });
  const range = useMemo(() => {
    if (picker.choice === 'custom') {
      return isValidCustomRange(picker.from, picker.to)
        ? null
        : { from: picker.from, to: picker.to };
    }
    return rangeFor(picker.choice, new Date(), ANALYTICS_TZ);
  }, [picker]);

  const base = `/admin/accounts/${merchantId}/analytics`;
  const qs = (extra = '') =>
    `from=${range?.from}&to=${range?.to}&tz=${encodeURIComponent(ANALYTICS_TZ)}${extra}`;
  const enabled = range !== null;
  const summary = useQuery({
    queryKey: ['hq', 'analytics', merchantId, 'summary', range?.from, range?.to],
    queryFn: () => hqFetch<AnalyticsSummaryResponse>(`${base}/summary?${qs()}`),
    enabled,
    staleTime: STALE_MS,
  });
  const series = useQuery({
    queryKey: ['hq', 'analytics', merchantId, 'series', range?.from, range?.to],
    queryFn: () => hqFetch<AnalyticsTimeseriesResponse>(`${base}/timeseries?${qs()}`),
    enabled,
    staleTime: STALE_MS,
  });
  const branches = useQuery({
    queryKey: ['hq', 'analytics', merchantId, 'branch', range?.from, range?.to],
    queryFn: () => hqFetch<AnalyticsBreakdownResponse>(`${base}/breakdown?${qs('&by=branch')}`),
    enabled,
    staleTime: STALE_MS,
  });

  const s = summary.data;
  const loading = summary.isPending && range !== null;
  return (
    <section
      aria-label="Analytics"
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        padding: 16,
        marginBottom: 16,
        display: 'grid',
        gap: 16,
      }}
    >
      <h2 style={{ fontSize: 16, fontWeight: 700, color: C.text, margin: 0 }}>Analytics</h2>
      <RangePicker value={picker} onChange={setPicker} />
      {summary.isError ? (
        <ListState
          status="error"
          isEmpty={false}
          emptyText=""
          error="Could not load analytics for this account."
          onRetry={() => void summary.refetch()}
        >
          {null}
        </ListState>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
            gap: 12,
          }}
        >
          <KpiCard label="Sessions started" value={n(s?.sessions ?? 0)} loading={loading} />
          <KpiCard label="Completed try-ons" value={n(s?.tried ?? 0)} loading={loading} />
          <KpiCard label="Items sold" value={n(s?.sold ?? 0)} loading={loading} />
          <KpiCard
            label="Credits spent"
            value={n(s?.creditsSpent ?? 0)}
            loading={loading}
            tone={s?.lowCredit ? 'warn' : undefined}
            hint={s?.lowCredit ? 'Balance is low' : undefined}
          />
        </div>
      )}
      {series.data && <TrendChart points={series.data.points} />}
      <ListState
        status={branches.status}
        isEmpty={(branches.data?.rows.length ?? 0) === 0}
        emptyText="No branch activity in this range."
        error={branches.error instanceof Error ? branches.error.message : null}
        onRetry={() => void branches.refetch()}
      >
        <BreakdownTable rows={branches.data?.rows ?? []} nameHeader="Branch" />
      </ListState>
    </section>
  );
}
