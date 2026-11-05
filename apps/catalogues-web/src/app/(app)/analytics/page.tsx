'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { C } from '@/components/tokens';
import { TopBar } from '@/components/topbar';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { isMerchantGateError } from '@/lib/api';
import { type AnalyticsRange, getMerchantAnalytics } from './api';
import { CategoriesPanel } from './categories-panel';
import { CustomersPanel } from './customers-panel';
import { Overview } from './overview';
import { ProductsPanel } from './products-panel';
import { formatWindow, RangeSelect } from './range-select';
import { card, sectionTitle } from './styles';

const DAYS: Record<AnalyticsRange, number> = { '7d': 7, '30d': 30, '90d': 90 };

const notice = {
  ...card,
  padding: 22,
  textAlign: 'center',
  color: C.mid,
  fontSize: 15,
} as const;

function Loading() {
  return (
    <div aria-busy="true" style={{ display: 'flex', flexWrap: 'wrap', gap: 28 }}>
      <div style={{ flex: '1.6 1 640px', minWidth: 0, display: 'grid', gap: 16 }}>
        <Skeleton h={150} r={16} />
        <Skeleton h={110} r={16} />
        <Skeleton h={300} r={16} />
        <Skeleton h={420} r={16} />
      </div>
      <div style={{ flex: '1 1 420px', minWidth: 0 }}>
        <Skeleton h={640} r={16} />
      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  const [range, setRange] = useState<AnalyticsRange>('30d');
  const q = useQuery({
    queryKey: ['merchant-analytics', range],
    queryFn: () => getMerchantAnalytics(range),
  });
  const d = q.data;
  const windowLabel = d ? formatWindow(d.range.from, d.range.to) : null;

  return (
    <div>
      <TopBar
        title="Analytics"
        subtitle="How customers use your try-on kiosk"
        right={<RangeSelect range={range} onChange={setRange} window={windowLabel} />}
      />
      <main
        style={{
          maxWidth: 1760,
          margin: '0 auto',
          padding: '28px 32px 40px',
        }}
      >
        {q.isLoading ? (
          <Loading />
        ) : q.isError ? (
          <ErrorState
            compact
            title={
              isMerchantGateError(q.error)
                ? 'Merchant account required'
                : 'Could not load analytics'
            }
            message={q.error instanceof Error ? q.error.message : undefined}
            onRetry={() => q.refetch()}
          />
        ) : d ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 28 }}>
            <div
              style={{
                flex: '1.6 1 640px',
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 28,
              }}
            >
              <section aria-labelledby="h-overview">
                <h2 id="h-overview" style={sectionTitle}>
                  Overview
                </h2>
                <Overview d={d} days={DAYS[range]} />
                {d.totalTryOns > 0 && d.breakdownSince && d.breakdownSince > d.range.from ? (
                  <p style={{ margin: '16px 0 0', fontSize: 13, color: C.mid }}>
                    Product breakdown covers try-ons since{' '}
                    {new Date(d.breakdownSince).toLocaleDateString('en-IN', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                    .
                  </p>
                ) : null}
                {d.totalTryOns > 0 && d.categories.length > 0 ? (
                  <CategoriesPanel categories={d.categories} />
                ) : null}
              </section>

              {d.totalTryOns === 0 ? (
                <div style={notice}>No try-ons in this period.</div>
              ) : d.categories.length === 0 ? (
                <div style={notice}>
                  Product breakdown starts with new try-ons. Earlier try-ons are counted in the
                  total above.
                </div>
              ) : (
                <section aria-labelledby="h-products">
                  <h2 id="h-products" style={sectionTitle}>
                    Products
                  </h2>
                  <ProductsPanel products={d.topProducts} />
                </section>
              )}
            </div>

            <div style={{ flex: '1 1 420px', minWidth: 0 }}>
              <section aria-labelledby="h-customers">
                <h2 id="h-customers" style={sectionTitle}>
                  Customers
                </h2>
                <CustomersPanel />
              </section>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}
