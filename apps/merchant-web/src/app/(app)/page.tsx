'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { BreakdownTable } from '@/components/analytics/BreakdownTable';
import { KpiCard } from '@/components/analytics/KpiCard';
import { type PickerState, RangePicker } from '@/components/analytics/RangePicker';
import { TrendChart } from '@/components/analytics/TrendChart';
import { useSession } from '@/components/session-provider';
import { C } from '@/components/tokens';
import { ListState } from '@/components/ui/state';
import {
  ANALYTICS_TZ,
  useAnalyticsBreakdown,
  useAnalyticsSummary,
  useAnalyticsTimeseries,
} from '@/lib/analytics';
import { apiFetch } from '@/lib/api';
import { formatCredits, formatRatio } from '@/lib/chart-scale';
import { isValidCustomRange, rangeFor } from '@/lib/date-range';
import { canManageOrg } from '@/lib/roles';
import { staffLimitState } from '@/lib/staff-limit';

type Branch = { id: string; name: string };
type BranchesRes = { branches: Branch[]; staffLimitPerBranch: number };
type StaffRes = { staff: { id: string; isActive: boolean }[] };
type DeviceRow = { id: string; paired: boolean; isActive: boolean };

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        padding: 16,
      }}
    >
      <div style={{ fontSize: 13, color: C.mid }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: C.text, marginTop: 4 }}>{value}</div>
      {hint && <div style={{ fontSize: 12, color: C.light, marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

const sectionTitle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 700,
  color: C.text,
  margin: '24px 0 10px',
};
const grid: React.CSSProperties = {
  display: 'grid',
  gap: 12,
  gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
};
const card: React.CSSProperties = {
  background: C.card,
  border: `1px solid ${C.border}`,
  borderRadius: 12,
  padding: 16,
};

function Dashboard({ isAdmin }: { isAdmin: boolean }) {
  const [picker, setPicker] = useState<PickerState>({ choice: '30d', from: '', to: '' });
  // Presets are computed in the dashboard tz, not the browser's; a custom range is only queried once valid.
  const range = useMemo(() => {
    if (picker.choice === 'custom') {
      return isValidCustomRange(picker.from, picker.to)
        ? null
        : { from: picker.from, to: picker.to };
    }
    return rangeFor(picker.choice, new Date(), ANALYTICS_TZ);
  }, [picker]);

  const summary = useAnalyticsSummary(range);
  const series = useAnalyticsTimeseries(range);
  const branches = useAnalyticsBreakdown(range, 'branch', isAdmin);
  const s = summary.data;
  const loading = range !== null && summary.status === 'pending';

  return (
    <section aria-label="Performance">
      <RangePicker value={picker} onChange={setPicker} />
      <div style={{ fontSize: 12, color: C.light, margin: '8px 0 14px' }}>
        {range ? `${range.from} to ${range.to}. ` : ''}Dates are in {ANALYTICS_TZ} time.
      </div>

      {range === null ? (
        <div style={{ ...card, color: C.mid, fontSize: 14 }}>Choose a valid date range.</div>
      ) : summary.status === 'error' ? (
        <ListState
          status="error"
          isEmpty={false}
          emptyText=""
          error="Could not load the performance numbers."
          onRetry={() => void summary.refetch()}
        >
          {null}
        </ListState>
      ) : (
        <>
          <div style={grid}>
            <KpiCard label="Sessions" value={formatCredits(s?.sessions ?? 0)} loading={loading} />
            <KpiCard label="Try-ons" value={formatCredits(s?.tried ?? 0)} loading={loading} />
            <KpiCard label="Sold" value={formatCredits(s?.sold ?? 0)} loading={loading} />
            <KpiCard
              label="Conversion"
              value={formatRatio(s?.conversion.sold ?? 0, s?.conversion.sessions ?? 0)}
              hint={`${formatCredits(s?.conversion.sold ?? 0)} sold / ${formatCredits(s?.conversion.sessions ?? 0)} sessions`}
              loading={loading}
            />
            <KpiCard
              label="Credits spent (net of refunds)"
              value={formatCredits(s?.creditsSpent ?? 0)}
              loading={loading}
            />
            {(loading || (s && s.creditsBalance !== null)) && (
              <KpiCard
                label="Credits balance"
                value={formatCredits(s?.creditsBalance ?? 0)}
                hint={
                  s?.lowCredit
                    ? `Low credit: below ${formatCredits(s.lowCreditThreshold)}. Top up soon.`
                    : undefined
                }
                tone={s?.lowCredit ? 'warn' : undefined}
                loading={loading}
              />
            )}
            {s?.mine && (
              <KpiCard
                label="My sales"
                value={formatCredits(s.mine.sold)}
                hint={`${formatCredits(s.mine.sessions)} sessions, ${formatCredits(s.mine.tried)} try-ons`}
              />
            )}
            <div style={card}>
              <div style={{ fontSize: 13, color: C.mid }}>Shopper sign-in metrics</div>
              <div style={{ fontSize: 13, color: C.light, marginTop: 6 }}>
                Available once WhatsApp sign-in launches
              </div>
            </div>
          </div>

          {s?.unattributed && (
            <div style={{ fontSize: 13, color: C.mid, marginTop: 12 }}>
              Legacy kiosk / other: {formatCredits(s.unattributed.jobs)} jobs,{' '}
              {formatCredits(s.unattributed.credits)} credits
            </div>
          )}

          <h2 style={sectionTitle}>Trend</h2>
          <div style={card}>
            {s && s.sessions === 0 && series.status !== 'pending' ? (
              <div style={{ fontSize: 14, color: C.mid }}>
                No sessions yet — pair a tablet.{' '}
                <Link href="/devices" style={{ color: C.pink, fontWeight: 600 }}>
                  Go to devices
                </Link>
              </div>
            ) : (
              <ListState
                status={series.status}
                isEmpty={series.data?.points.length === 0}
                emptyText="No data for this range."
                error="Could not load the trend."
                onRetry={() => void series.refetch()}
              >
                <TrendChart points={series.data?.points ?? []} />
                <div style={{ fontSize: 12, color: C.light, marginTop: 8 }}>
                  Visits and sales are counted on the day the visit started.
                </div>
              </ListState>
            )}
          </div>

          {isAdmin && (
            <>
              <h2 style={sectionTitle}>Branches</h2>
              <ListState
                status={branches.status}
                isEmpty={branches.data?.rows.length === 0}
                emptyText="No branches to show."
                error="Could not load the branch table."
                onRetry={() => void branches.refetch()}
              >
                <BreakdownTable rows={branches.data?.rows ?? []} nameHeader="Branch" />
              </ListState>
            </>
          )}
        </>
      )}
    </section>
  );
}

export default function OverviewPage() {
  const { me } = useSession();
  const branches = useQuery({
    queryKey: ['org', 'branches'],
    queryFn: () => apiFetch<BranchesRes>('/v1/merchant/org/branches'),
  });
  const staff = useQuery({
    queryKey: ['org', 'staff'],
    queryFn: () => apiFetch<StaffRes>('/v1/merchant/org/staff'),
  });
  const devices = useQuery({
    queryKey: ['org', 'devices'],
    queryFn: () => apiFetch<DeviceRow[]>('/v1/merchant/org/devices'),
  });
  if (!me) return null;

  const queries = [branches, staff, devices];
  const status = queries.some((q) => q.status === 'error')
    ? 'error'
    : queries.every((q) => q.status === 'success')
      ? 'success'
      : 'pending';
  const retry = () => {
    for (const q of queries) if (q.status === 'error') void q.refetch();
  };

  const isAdmin = canManageOrg(me.role);
  const deviceRows = devices.data ?? [];
  const activeStaff = (staff.data?.staff ?? []).filter((s) => s.isActive).length;
  const limit = branches.data?.staffLimitPerBranch ?? me.staffLimitPerBranch;
  const ownBranch = branches.data?.branches[0];

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: C.text, margin: '0 0 16px' }}>Overview</h1>
      <Dashboard isAdmin={isAdmin} />
      <h2 style={sectionTitle}>Setup</h2>
      <ListState
        status={status}
        isEmpty={false}
        emptyText=""
        error="Could not load the overview."
        onRetry={retry}
      >
        <div
          style={{
            display: 'grid',
            gap: 12,
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          }}
        >
          {isAdmin ? (
            <>
              <Stat label="Branches" value={String(branches.data?.branches.length ?? 0)} />
              <Stat label="Active staff" value={String(activeStaff)} />
              <Stat
                label="Devices"
                value={`${deviceRows.filter((d) => d.paired).length} paired`}
                hint={`${deviceRows.filter((d) => d.isActive).length} active of ${deviceRows.length}`}
              />
            </>
          ) : (
            <>
              <Stat label="Your branch" value={ownBranch?.name ?? '-'} />
              <Stat label="Devices in branch" value={String(deviceRows.length)} />
            </>
          )}
          <Stat
            label="Staff limit per branch"
            value={String(limit)}
            hint={isAdmin ? undefined : `${staffLimitState(activeStaff, limit).label} used`}
          />
          <Stat
            label="Device quota per month"
            value={me.deviceQuotaPerMonth === null ? 'Not set' : String(me.deviceQuotaPerMonth)}
          />
        </div>
      </ListState>
    </div>
  );
}
