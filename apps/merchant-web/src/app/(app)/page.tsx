'use client';
import type { AnalyticsBreakdownRow } from '@aivastra/types';
import { MousePointerClick, Shirt, ShoppingBag, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { FunnelCard } from '@/components/analytics/FunnelCard';
import { KpiCard, type KpiDelta } from '@/components/analytics/KpiCard';
import { type PickerState, RangePicker } from '@/components/analytics/RangePicker';
import { TrendLineChart } from '@/components/analytics/TrendLineChart';
import { useSession } from '@/components/session-provider';
import { C, M } from '@/components/tokens';
import { ListState } from '@/components/ui/state';
import {
  ANALYTICS_TZ,
  useAnalyticsBreakdown,
  useAnalyticsSummary,
  useAnalyticsTimeseries,
} from '@/lib/analytics';
import { formatCredits, formatRatio } from '@/lib/chart-scale';
import { isValidCustomRange, previousRange, rangeFor } from '@/lib/date-range';
import { canManageOrg } from '@/lib/roles';

const card: React.CSSProperties = {
  background: C.card,
  border: `1px solid ${C.border2}`,
  borderRadius: 12,
  padding: 16,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
};

function CardHead({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle: string;
  action?: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 15, flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <h2 style={{ margin: 0, fontSize: 16, lineHeight: '20px', fontWeight: 700, color: C.text }}>
          {title}
        </h2>
        <p style={{ margin: 0, fontSize: 12, lineHeight: '15px', fontWeight: 600, color: C.mid }}>
          {subtitle}
        </p>
      </div>
      {action}
    </div>
  );
}

/** Percent change against the previous period; null when there is no baseline to compare with. */
function pctDelta(cur: number, prev: number): KpiDelta | null {
  if (prev <= 0) return null;
  const pct = Math.round(((cur - prev) / prev) * 1000) / 10;
  return { text: `${pct >= 0 ? '+' : ''}${pct}%`, positive: pct >= 0 };
}

/** Conversion is itself a percentage, so its change is in percentage points. */
function pointsDelta(cur: number, prev: number): KpiDelta | null {
  if (prev <= 0) return null;
  const pts = Math.round((cur - prev) * 10000) / 100;
  return { text: `${pts >= 0 ? '+' : ''}${pts} percentage points`, positive: pts >= 0 };
}

const th: React.CSSProperties = {
  padding: '10px 12px',
  textAlign: 'center',
  fontSize: 12,
  fontWeight: 700,
  color: C.text,
  background: M.mutedTint,
  whiteSpace: 'nowrap',
};
const td: React.CSSProperties = {
  padding: '10px 12px',
  textAlign: 'center',
  fontSize: 12,
  fontWeight: 600,
  color: C.mid,
  borderTop: `1px solid ${C.border}`,
  whiteSpace: 'nowrap',
};

/** Store-wise table in the design's bordered, tinted-header style. */
function BranchTable({ rows }: { rows: AnalyticsBreakdownRow[] }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table
        style={{
          width: '100%',
          minWidth: 560,
          borderCollapse: 'separate',
          borderSpacing: 0,
          border: `1px solid ${C.border2}`,
          borderRadius: 8,
          overflow: 'hidden',
        }}
      >
        <thead>
          <tr>
            <th scope="col" style={{ ...th, textAlign: 'left' }}>
              Branch
            </th>
            <th scope="col" style={th}>
              Sessions
            </th>
            <th scope="col" style={th}>
              Try-ons
            </th>
            <th scope="col" style={th}>
              Sold
            </th>
            <th scope="col" style={th}>
              Conversion Rate
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td style={{ ...td, textAlign: 'left' }}>{r.name}</td>
              <td style={td}>{formatCredits(r.sessions)}</td>
              <td style={td}>{formatCredits(r.tried)}</td>
              <td style={{ ...td, fontWeight: 800, color: C.text }}>{formatCredits(r.sold)}</td>
              <td style={td}>{formatRatio(r.sold, r.sessions)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Dashboard({ isAdmin }: { isAdmin: boolean }) {
  const [picker, setPicker] = useState<PickerState>({ choice: '30d', from: '', to: '' });
  const range = useMemo(() => {
    if (picker.choice === 'custom') {
      return isValidCustomRange(picker.from, picker.to)
        ? null
        : { from: picker.from, to: picker.to };
    }
    return rangeFor(picker.choice, new Date(), ANALYTICS_TZ);
  }, [picker]);
  const prev = useMemo(() => (range ? previousRange(range) : null), [range]);

  const summary = useAnalyticsSummary(range);
  const previous = useAnalyticsSummary(prev);
  const series = useAnalyticsTimeseries(range);
  const branches = useAnalyticsBreakdown(range, 'branch', isAdmin);

  const s = summary.data;
  const p = previous.data;
  const loading = summary.isPending && range !== null;

  return (
    <>
      <RangePicker value={picker} onChange={setPicker} />

      {summary.isError && (
        <ListState
          status="error"
          isEmpty={false}
          emptyText=""
          error="Could not load the dashboard."
          onRetry={() => void summary.refetch()}
        >
          {null}
        </ListState>
      )}

      {s?.lowCredit && (
        <div
          role="status"
          style={{
            ...card,
            gap: 4,
            borderColor: C.amber,
            fontSize: 13,
            fontWeight: 600,
            color: C.text,
          }}
        >
          Credits are running low: {formatCredits(s.creditsBalance ?? 0)} left. Try-ons stop at
          zero, so top up soon.
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
          gap: 16,
        }}
      >
        <KpiCard
          label="Sessions Started"
          icon={<MousePointerClick size={20} />}
          value={formatCredits(s?.sessions ?? 0)}
          loading={loading}
          delta={s && p ? pctDelta(s.sessions, p.sessions) : null}
          hint="No earlier period to compare"
        />
        <KpiCard
          label="Completed Virtual Try-ons"
          icon={<Shirt size={20} />}
          value={formatCredits(s?.tried ?? 0)}
          loading={loading}
          delta={s && p ? pctDelta(s.tried, p.tried) : null}
          hint="No earlier period to compare"
        />
        <KpiCard
          label="Items Sold"
          icon={<ShoppingBag size={20} />}
          value={formatCredits(s?.sold ?? 0)}
          loading={loading}
          delta={s && p ? pctDelta(s.sold, p.sold) : null}
          hint="No earlier period to compare"
        />
        <KpiCard
          label="Session to Sale Rate"
          icon={<TrendingUp size={20} />}
          value={formatRatio(s?.conversion.sold ?? 0, s?.conversion.sessions ?? 0)}
          loading={loading}
          delta={s && p ? pointsDelta(s.conversion.ratio, p.conversion.ratio) : null}
          hint="No earlier period to compare"
        />
      </div>

      {s?.mine && (
        <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: C.mid }}>
          Your sales: {formatCredits(s.mine.sessions)} sessions, {formatCredits(s.mine.tried)}{' '}
          try-ons, {formatCredits(s.mine.sold)} sold.
        </p>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
        <section style={{ ...card, flex: '1 1 340px' }}>
          <CardHead
            title="Try-on Performance"
            subtitle="Track sessions, try-ons and sold items day by day."
          />
          <ListState
            status={series.status}
            isEmpty={false}
            emptyText=""
            error="Could not load the trend."
            onRetry={() => void series.refetch()}
          >
            <TrendLineChart points={series.data?.points ?? []} />
          </ListState>
        </section>
        <section style={{ ...card, flex: '0 0 500px', maxWidth: '100%' }}>
          <CardHead title="Virtual Try-on Funnel" subtitle="Track the try-on journey to a sale." />
          <FunnelCard sessions={s?.sessions ?? 0} tried={s?.tried ?? 0} sold={s?.sold ?? 0} />
        </section>
      </div>

      {isAdmin && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <CardHead
            title="Branch-wise Performance"
            subtitle="Compare performance across your branches."
            action={
              <Link
                href="/performance"
                style={{
                  marginTop: 12,
                  fontSize: 12,
                  fontWeight: 700,
                  color: M.brand,
                  textDecoration: 'none',
                }}
              >
                View All →
              </Link>
            }
          />
          <ListState
            status={branches.status}
            isEmpty={(branches.data?.rows.length ?? 0) === 0}
            emptyText="No branches yet."
            error="Could not load branches."
            onRetry={() => void branches.refetch()}
          >
            <BranchTable rows={branches.data?.rows ?? []} />
          </ListState>
        </section>
      )}

      {s?.unattributed && s.unattributed.jobs > 0 && (
        <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: C.mid }}>
          Not counted above: {formatCredits(s.unattributed.jobs)} earlier try-ons made before
          sessions were tracked ({formatCredits(s.unattributed.credits)} credits).
        </p>
      )}
    </>
  );
}

export default function OverviewPage() {
  const { me } = useSession();
  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h1 style={{ margin: 0, fontSize: 20, lineHeight: '25px', fontWeight: 700, color: C.text }}>
          Dashboard
        </h1>
        <p style={{ margin: 0, fontSize: 14, lineHeight: '18px', fontWeight: 600, color: C.mid }}>
          Monitor your store performance and customer engagement from virtual try-ons.
        </p>
      </div>
      <Dashboard isAdmin={me ? canManageOrg(me.role) : false} />
    </>
  );
}
