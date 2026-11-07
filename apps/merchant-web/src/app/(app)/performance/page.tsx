'use client';
import type { AnalyticsBreakdownBy, AnalyticsBreakdownRow } from '@aivastra/types';
import { useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import {
  type BreakdownDisplayRow,
  type BreakdownSortKey,
  BreakdownTable,
} from '@/components/analytics/BreakdownTable';
import { type PickerState, RangePicker } from '@/components/analytics/RangePicker';
import { useSession } from '@/components/session-provider';
import { C } from '@/components/tokens';
import { ListState } from '@/components/ui/state';
import { ANALYTICS_TZ, useAnalyticsBreakdown } from '@/lib/analytics';
import { apiFetch } from '@/lib/api';
import { isValidCustomRange, rangeFor } from '@/lib/date-range';
import { canManageOrg } from '@/lib/roles';
import { sortRows } from '@/lib/table-sort';

const TABS: { id: AnalyticsBreakdownBy; param: string; label: string; header: string }[] = [
  { id: 'branch', param: 'branches', label: 'Branches', header: 'Branch' },
  { id: 'staff', param: 'staff', label: 'Staff', header: 'Staff' },
  { id: 'device', param: 'devices', label: 'Devices', header: 'Device' },
];
const DEFAULT_TAB = {
  id: 'branch',
  param: 'branches',
  label: 'Branches',
  header: 'Branch',
} as const;
const tabFromParam = (p: string | null): (typeof TABS)[number] =>
  TABS.find((t) => t.param === p) ?? DEFAULT_TAB;

const chip: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 32,
  padding: '0 10px',
  borderRadius: 999,
  border: `1px solid ${C.border2}`,
  background: C.white,
  color: C.text,
  fontFamily: 'inherit',
  fontSize: 13,
  cursor: 'pointer',
};

type NamedRow = { id: string; name: string };

function Performance() {
  const { me, status } = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const isAdmin = !!me && canManageOrg(me.role);

  useEffect(() => {
    if (status === 'ready' && me && !canManageOrg(me.role)) router.replace('/');
  }, [status, me, router]);

  const tab = tabFromParam(params.get('tab'));
  const branchId = params.get('branchId') ?? undefined;
  const staffId = params.get('staffId') ?? undefined;

  const [picker, setPicker] = useState<PickerState>({ choice: '30d', from: '', to: '' });
  const [sort, setSort] = useState<{ key: BreakdownSortKey; dir: 'asc' | 'desc' }>({
    key: 'sessions',
    dir: 'desc',
  });
  // Presets are computed in the dashboard tz, not the browser's; a custom range is only queried once valid.
  const range = useMemo(() => {
    if (picker.choice === 'custom') {
      return isValidCustomRange(picker.from, picker.to)
        ? null
        : { from: picker.from, to: picker.to };
    }
    return rangeFor(picker.choice, new Date(), ANALYTICS_TZ);
  }, [picker]);

  // Names for the filter chips, so a reloaded URL still reads "Branch: Mumbai" (cached org queries).
  const branchNames = useQuery({
    queryKey: ['org', 'branches'],
    queryFn: () => apiFetch<{ branches: NamedRow[] }>('/v1/merchant/org/branches'),
    enabled: isAdmin && !!branchId,
  });
  const staffNames = useQuery({
    queryKey: ['org', 'staff'],
    queryFn: () =>
      apiFetch<{ staff: { id: string; displayName: string; email: string }[] }>(
        '/v1/merchant/org/staff',
      ),
    enabled: isAdmin && !!staffId,
  });
  const branchName = branchNames.data?.branches.find((b) => b.id === branchId)?.name;
  const staffRow = staffNames.data?.staff.find((s) => s.id === staffId);
  const staffName = staffRow ? staffRow.displayName || staffRow.email : undefined;

  // The branch tab is never narrowed; staff narrows by branch; devices by branch and staff.
  const q = useAnalyticsBreakdown(
    range,
    tab.id,
    isAdmin,
    tab.id === 'branch' ? undefined : branchId,
    tab.id === 'device' ? { staffId } : {},
  );

  const go = (next: { tab: string; branchId?: string; staffId?: string }) => {
    const p = new URLSearchParams({ tab: next.tab });
    if (next.branchId) p.set('branchId', next.branchId);
    if (next.staffId) p.set('staffId', next.staffId);
    router.replace(`/performance?${p.toString()}`);
  };

  const rows = useMemo<BreakdownDisplayRow[]>(
    () =>
      sortRows(
        (q.data?.rows ?? []).map((r) => ({
          ...r,
          ratio: r.sessions > 0 ? r.sold / r.sessions : 0,
        })),
        sort.key,
        sort.dir,
      ),
    [q.data, sort],
  );

  if (status !== 'ready' || !me || !isAdmin) return null;

  const onSort = (key: BreakdownSortKey) =>
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'name' ? 'asc' : 'desc' },
    );

  const onRowClick = (row: AnalyticsBreakdownRow) => {
    if (tab.id === 'branch') go({ tab: 'staff', branchId: row.id });
    else if (tab.id === 'staff') go({ tab: 'devices', branchId, staffId: row.id });
  };

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: C.text, margin: '0 0 16px' }}>
        Performance
      </h1>
      <RangePicker value={picker} onChange={setPicker} />
      <div style={{ fontSize: 12, color: C.light, margin: '8px 0 14px' }}>
        {range ? `${range.from} to ${range.to}. ` : ''}Dates are in {ANALYTICS_TZ} time.
      </div>

      <div
        role="tablist"
        aria-label="Breakdown"
        style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}
      >
        {TABS.map((t) => {
          const active = t.id === tab.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`tab-${t.param}`}
              aria-selected={active}
              aria-controls="perf-panel"
              onClick={() =>
                go({ tab: t.param, branchId, staffId: t.id === 'device' ? staffId : undefined })
              }
              style={{
                height: 36,
                padding: '0 14px',
                borderRadius: 8,
                border: `1px solid ${active ? C.pink : C.border2}`,
                background: active ? C.pink : C.white,
                color: active ? C.white : C.text,
                fontFamily: 'inherit',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {(branchId || staffId) && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          {branchId && (
            <button
              type="button"
              style={chip}
              aria-label={`Remove branch filter ${branchName ?? ''}`.trim()}
              onClick={() => go({ tab: tab.id === 'device' ? 'staff' : tab.param })}
            >
              Branch: {branchName ?? 'Selected branch'} <span aria-hidden="true">{'×'}</span>
            </button>
          )}
          {staffId && (
            <button
              type="button"
              style={chip}
              aria-label={`Remove staff filter ${staffName ?? ''}`.trim()}
              onClick={() => go({ tab: tab.param, branchId })}
            >
              Staff: {staffName ?? 'Selected staff'} <span aria-hidden="true">{'×'}</span>
            </button>
          )}
        </div>
      )}

      {tab.id === 'staff' && (
        <div style={{ fontSize: 12, color: C.light, marginTop: 12 }}>
          <span
            title="Sold is counted by the staff member who sold the item, sessions by the staff member who ran the session, so conversion can exceed 100%."
            style={{ cursor: 'help', fontWeight: 700, marginRight: 6 }}
          >
            ?
          </span>
          Per-staff conversion can exceed 100%: sales are counted by item staff, sessions by session
          staff.
        </div>
      )}

      <div
        role="tabpanel"
        id="perf-panel"
        aria-labelledby={`tab-${tab.param}`}
        style={{ marginTop: 12 }}
      >
        {range === null ? (
          <div style={{ color: C.mid, fontSize: 14 }}>Choose a valid date range.</div>
        ) : (
          <ListState
            status={q.status}
            isEmpty={q.data?.rows.length === 0}
            emptyText="No activity in this range."
            error={`Could not load the ${tab.label.toLowerCase()} table.`}
            onRetry={() => void q.refetch()}
          >
            <BreakdownTable
              rows={rows}
              nameHeader={tab.header}
              sort={sort}
              onSort={onSort}
              onRowClick={tab.id === 'device' ? undefined : onRowClick}
            />
          </ListState>
        )}
      </div>
    </div>
  );
}

// useSearchParams needs a Suspense boundary for the static build.
export default function PerformancePage() {
  return (
    <Suspense fallback={null}>
      <Performance />
    </Suspense>
  );
}
