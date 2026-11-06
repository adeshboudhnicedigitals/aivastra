'use client';
import { useQuery } from '@tanstack/react-query';
import { useSession } from '@/components/session-provider';
import { C } from '@/components/tokens';
import { ListState } from '@/components/ui/state';
import { apiFetch } from '@/lib/api';
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
