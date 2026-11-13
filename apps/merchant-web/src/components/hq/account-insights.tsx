'use client';
import type {
  InsightsFunnelResponse,
  InsightsReliabilityResponse,
  LostDemandResponse,
  OutOfStockResponse,
} from '@aivastra/types';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { type PickerState, RangePicker } from '@/components/analytics/RangePicker';
import { InsightsSections } from '@/components/insights/InsightsSections';
import { C } from '@/components/tokens';
import { PremiumSelect } from '@/components/ui/premium-select';
import { ANALYTICS_TZ } from '@/lib/analytics';
import { isValidCustomRange, rangeFor } from '@/lib/date-range';
import { hqFetch } from '@/lib/hq-api';

const STALE_MS = 30_000;

function useInsight<T>(
  merchantId: string,
  name: string,
  range: { from: string; to: string } | null,
  branchId: string,
) {
  const qs = `from=${range?.from}&to=${range?.to}&tz=${encodeURIComponent(ANALYTICS_TZ)}${
    branchId ? `&branchId=${branchId}` : ''
  }`;
  return useQuery({
    queryKey: ['hq', 'insights', merchantId, name, range?.from, range?.to, branchId],
    queryFn: () => hqFetch<T>(`/admin/accounts/${merchantId}/insights/${name}?${qs}`),
    enabled: range !== null,
    staleTime: STALE_MS,
  });
}

// One account's Insights for the team console: the retailer's sections, fed from
// /admin/accounts/:id/insights/* through the console's own client.
export function AccountInsights({
  merchantId,
  branches,
}: {
  merchantId: string;
  branches: Array<{ id: string; name: string }>;
}) {
  const [picker, setPicker] = useState<PickerState>({ choice: '30d', from: '', to: '' });
  const range = useMemo(() => {
    if (picker.choice === 'custom') {
      return isValidCustomRange(picker.from, picker.to)
        ? null
        : { from: picker.from, to: picker.to };
    }
    return rangeFor(picker.choice, new Date(), ANALYTICS_TZ);
  }, [picker]);

  const [branchId, setBranchId] = useState('');
  const funnel = useInsight<InsightsFunnelResponse>(merchantId, 'funnel', range, branchId);
  const lost = useInsight<LostDemandResponse>(merchantId, 'lost-demand', range, branchId);
  const oos = useInsight<OutOfStockResponse>(merchantId, 'out-of-stock', range, branchId);
  const rel = useInsight<InsightsReliabilityResponse>(merchantId, 'reliability', range, branchId);

  return (
    <section
      aria-label="Insights"
      style={{
        gridTemplateColumns: 'minmax(0, 1fr)',
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        padding: 16,
        marginBottom: 16,
        display: 'grid',
        gap: 16,
      }}
    >
      <h2 style={{ fontSize: 16, fontWeight: 700, color: C.text, margin: 0 }}>Insights</h2>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
        <RangePicker value={picker} onChange={setPicker} />
        {branches.length > 1 && (
          <PremiumSelect
            ariaLabel="Branch"
            height={32}
            minWidth={150}
            value={branchId}
            options={[
              { value: '', label: 'All branches' },
              ...branches.map((b) => ({ value: b.id, label: b.name })),
            ]}
            onChange={(v) => setBranchId(String(v))}
          />
        )}
      </div>
      <InsightsSections funnel={funnel} lost={lost} oos={oos} rel={rel} />
    </section>
  );
}
