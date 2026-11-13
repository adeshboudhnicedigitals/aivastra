'use client';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { type PickerState, RangePicker } from '@/components/analytics/RangePicker';
import { InsightsSections } from '@/components/insights/InsightsSections';
import { useSession } from '@/components/session-provider';
import { C } from '@/components/tokens';
import { PremiumSelect } from '@/components/ui/premium-select';
import { ANALYTICS_TZ } from '@/lib/analytics';
import { apiFetch } from '@/lib/api';
import { isValidCustomRange, rangeFor } from '@/lib/date-range';
import {
  useInsightsFunnel,
  useInsightsReliability,
  useLostDemand,
  useOutOfStock,
} from '@/lib/insights';
import { canManageOrg } from '@/lib/roles';

export default function InsightsPage() {
  const [picker, setPicker] = useState<PickerState>({ choice: '30d', from: '', to: '' });
  const range = useMemo(() => {
    if (picker.choice === 'custom') {
      return isValidCustomRange(picker.from, picker.to)
        ? null
        : { from: picker.from, to: picker.to };
    }
    return rangeFor(picker.choice, new Date(), ANALYTICS_TZ);
  }, [picker]);

  const { me } = useSession();
  const isAdmin = me ? canManageOrg(me.role) : false;
  // Staff are pinned to their own branch by the server, so only admins get a picker.
  const [branchId, setBranchId] = useState('');
  const branches = useQuery({
    queryKey: ['org', 'branches'],
    queryFn: () =>
      apiFetch<{ branches: { id: string; name: string }[] }>('/v1/merchant/org/branches'),
    enabled: isAdmin,
  });
  const branch = branchId || undefined;
  const funnel = useInsightsFunnel(range, branch);
  const lost = useLostDemand(range, branch);
  const oos = useOutOfStock(range, branch);
  const rel = useInsightsReliability(range, branch);
  const f = funnel.data;
  const r = rel.data;
  const loadingF = funnel.isPending && range !== null;
  const loadingR = rel.isPending && range !== null;

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h1 style={{ margin: 0, fontSize: 20, lineHeight: '25px', fontWeight: 700, color: C.text }}>
          Insights
        </h1>
        <p style={{ margin: 0, fontSize: 14, lineHeight: '18px', fontWeight: 600, color: C.mid }}>
          Where try-ons turn into sales, what shoppers want but do not buy, and what is out of
          stock.
        </p>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
        <RangePicker value={picker} onChange={setPicker} />
        {isAdmin && (branches.data?.branches.length ?? 0) > 1 && (
          <PremiumSelect
            ariaLabel="Branch"
            height={32}
            minWidth={150}
            value={branchId}
            options={[
              { value: '', label: 'All branches' },
              ...(branches.data?.branches ?? []).map((b) => ({ value: b.id, label: b.name })),
            ]}
            onChange={(v) => setBranchId(String(v))}
          />
        )}
      </div>

      <InsightsSections funnel={funnel} lost={lost} oos={oos} rel={rel} />
    </>
  );
}
