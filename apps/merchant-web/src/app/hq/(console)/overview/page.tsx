'use client';
import type { AdminOverviewResponse } from '@aivastra/types';
import { useQuery } from '@tanstack/react-query';
import { Coins, ShoppingBag, Store, Users } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { KpiCard } from '@/components/analytics/KpiCard';
import { type PickerState, RangePicker } from '@/components/analytics/RangePicker';
import { TrendChart } from '@/components/analytics/TrendChart';
import { EmptyBox, ErrorBox, PageHead, td, th } from '@/components/hq/list-parts';
import { Card, Skeleton } from '@/components/hq/ui';
import { C } from '@/components/tokens';
import { ANALYTICS_TZ } from '@/lib/analytics';
import { formatRatio } from '@/lib/chart-scale';
import { isValidCustomRange, rangeFor } from '@/lib/date-range';
import { hqFetch } from '@/lib/hq-api';

const n = (v: number) => v.toLocaleString('en-IN');

// Every account at once: the totals the per-account pages add up to, the daily trend, and the
// busiest accounts. Numbers use the same definitions as an account's own dashboard.
export default function OverviewPage() {
  const [picker, setPicker] = useState<PickerState>({ choice: '30d', from: '', to: '' });
  const range = useMemo(() => {
    if (picker.choice === 'custom') {
      return isValidCustomRange(picker.from, picker.to)
        ? null
        : { from: picker.from, to: picker.to };
    }
    return rangeFor(picker.choice, new Date(), ANALYTICS_TZ);
  }, [picker]);

  const q = useQuery({
    queryKey: ['hq', 'overview', range?.from, range?.to],
    queryFn: () =>
      hqFetch<AdminOverviewResponse>(
        `/admin/analytics/overview?from=${range?.from}&to=${range?.to}&tz=${encodeURIComponent(ANALYTICS_TZ)}`,
      ),
    enabled: range !== null,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
  const t = q.data?.totals;
  const loading = q.isPending && range !== null;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <PageHead
        title="Overview"
        lede="Activity across every account. Open an account for its own branches, tablets and peak hours."
      />
      <RangePicker value={picker} onChange={setPicker} />

      {q.isError ? (
        <ErrorBox what="the overview" error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
              gap: 12,
            }}
          >
            <KpiCard
              label="Active accounts"
              value={n(t?.activeAccounts ?? 0)}
              hint="Started a session in this range"
              loading={loading}
              icon={<Store size={16} aria-hidden="true" />}
            />
            <KpiCard
              label="Sessions started"
              value={n(t?.sessions ?? 0)}
              loading={loading}
              icon={<Users size={16} aria-hidden="true" />}
            />
            <KpiCard
              label="Items sold"
              value={n(t?.sold ?? 0)}
              hint={t ? `${formatRatio(t.sold, t.sessions)} of sessions` : undefined}
              loading={loading}
              icon={<ShoppingBag size={16} aria-hidden="true" />}
            />
            <KpiCard
              label="Credits spent"
              value={n(t?.creditsSpent ?? 0)}
              hint="In-store jobs, net of refunds"
              loading={loading}
              icon={<Coins size={16} aria-hidden="true" />}
            />
          </div>

          <Card title="Daily activity">
            {q.data ? <TrendChart points={q.data.points} /> : <Skeleton h={180} />}
          </Card>

          <Card title="Busiest accounts">
            {loading ? (
              <Skeleton h={120} />
            ) : (q.data?.top.length ?? 0) === 0 ? (
              <EmptyBox>No account activity in this range.</EmptyBox>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                  <caption className="sr-only">Busiest accounts in this range</caption>
                  <thead>
                    <tr style={{ color: C.mid, fontSize: 12 }}>
                      <th scope="col" style={th}>
                        Account
                      </th>
                      <th scope="col" style={{ ...th, textAlign: 'right' }}>
                        Sessions
                      </th>
                      <th scope="col" style={{ ...th, textAlign: 'right' }}>
                        Try-ons
                      </th>
                      <th scope="col" style={{ ...th, textAlign: 'right' }}>
                        Sold
                      </th>
                      <th scope="col" style={{ ...th, textAlign: 'right' }}>
                        Credits
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.data?.top.map((a) => (
                      <tr key={a.merchantId} style={{ borderTop: `1px solid ${C.border}` }}>
                        <td style={td}>
                          <Link
                            href={`/hq/accounts/${a.merchantId}`}
                            style={{ color: C.text, fontWeight: 700, textDecoration: 'none' }}
                          >
                            {a.companyName}
                          </Link>
                        </td>
                        <td style={{ ...td, textAlign: 'right' }}>{n(a.sessions)}</td>
                        <td style={{ ...td, textAlign: 'right' }}>{n(a.tried)}</td>
                        <td style={{ ...td, textAlign: 'right' }}>{n(a.sold)}</td>
                        <td style={{ ...td, textAlign: 'right' }}>{n(a.creditsSpent)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
