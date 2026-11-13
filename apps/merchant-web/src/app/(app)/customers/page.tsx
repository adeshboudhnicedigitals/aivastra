'use client';
import type {
  CustomerFilters,
  CustomerListResponse,
  CustomerProfile,
  CustomerRow,
} from '@aivastra/types';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useSession } from '@/components/session-provider';
import { C } from '@/components/tokens';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { PremiumSelect } from '@/components/ui/premium-select';
import { ListState } from '@/components/ui/state';
import { useToast } from '@/components/ui/toast';
import { apiDownload, apiFetch } from '@/lib/api';
import {
  consentLabel,
  displayName,
  EMPTY_FILTERS,
  filtersToQuery,
  hasFilters,
} from '@/lib/customers';
import { canManageOrg } from '@/lib/roles';

// CRM phase 4: the merchant's customer list. Admin only (spec §3). Phones are masked here; the
// full number is shown on a profile, and viewing it, exporting and deleting are all audited.

type Segment = { id: string; name: string; filters: CustomerFilters };
type Branch = { id: string; name: string };

const card: React.CSSProperties = {
  background: C.card,
  border: `1px solid ${C.border}`,
  borderRadius: 12,
  padding: 16,
  marginBottom: 16,
};
const field: React.CSSProperties = {
  height: 40,
  padding: '0 12px',
  borderRadius: 8,
  border: `1px solid ${C.border2}`,
  background: C.field,
  color: C.text,
  fontFamily: 'inherit',
  fontSize: 14,
  minWidth: 0,
};
const btn = (primary?: boolean, danger?: boolean): React.CSSProperties => ({
  height: 40,
  padding: '0 16px',
  borderRadius: 8,
  border: primary || danger ? 'none' : `1px solid ${C.border2}`,
  background: danger ? C.danger : primary ? C.btnPrimary : C.white,
  color: primary || danger ? C.white : C.text,
  fontFamily: 'inherit',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
});
const dateOnly = (iso: string) => new Date(iso).toLocaleDateString('en-IN');

export default function CustomersPage() {
  const { me, status } = useSession();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const isAdmin = !!me && canManageOrg(me.role);

  useEffect(() => {
    if (status === 'ready' && me && !canManageOrg(me.role)) router.replace('/');
  }, [status, me, router]);

  const [draft, setDraft] = useState<CustomerFilters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<CustomerFilters>(EMPTY_FILTERS);
  const [openId, setOpenId] = useState<string | null>(null);
  const [segmentName, setSegmentName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const branches = useQuery({
    queryKey: ['org', 'branches'],
    queryFn: () => apiFetch<{ branches: Branch[] }>('/v1/merchant/org/branches'),
    enabled: isAdmin,
  });
  const segments = useQuery({
    queryKey: ['crm', 'segments'],
    queryFn: () => apiFetch<{ items: Segment[] }>('/v1/merchant/customer-segments'),
    enabled: isAdmin,
  });
  const list = useInfiniteQuery({
    queryKey: ['crm', 'customers', applied],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      apiFetch<CustomerListResponse>(
        `/v1/merchant/customers${filtersToQuery(applied, { limit: 50, cursor: pageParam })}`,
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: isAdmin,
  });
  const profile = useQuery({
    queryKey: ['crm', 'customer', openId],
    queryFn: () => apiFetch<CustomerProfile>(`/v1/merchant/customers/${openId}`),
    enabled: isAdmin && openId !== null,
    // Every fetch is audited: never refetch a profile behind the user's back.
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
  });

  const err = (e: unknown) =>
    toast.show(e instanceof Error ? e.message : 'The request could not be completed.');
  const saveSegment = useMutation({
    mutationFn: () =>
      apiFetch('/v1/merchant/customer-segments', {
        method: 'POST',
        body: JSON.stringify({ name: segmentName.trim(), filters: applied }),
      }),
    onSuccess: () => {
      setSegmentName('');
      toast.show('Segment saved', 'success');
      qc.invalidateQueries({ queryKey: ['crm', 'segments'] });
    },
    onError: err,
  });
  const deleteSegment = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/v1/merchant/customer-segments/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['crm', 'segments'] }),
    onError: err,
  });
  const exportCsv = useMutation({
    mutationFn: async () => {
      const blob = await apiDownload(`/v1/merchant/customers/export.csv${filtersToQuery(applied)}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'customers.csv';
      a.click();
      URL.revokeObjectURL(url);
    },
    onError: err,
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/v1/merchant/customers/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setConfirmDelete(false);
      setOpenId(null);
      toast.show('Customer deleted', 'success');
      qc.invalidateQueries({ queryKey: ['crm', 'customers'] });
    },
    onError: err,
  });

  if (status !== 'ready' || !me || !isAdmin) return null;

  const rows: CustomerRow[] = list.data?.pages.flatMap((p) => p.items) ?? [];
  const branchOptions = [
    { value: '', label: 'All branches' },
    ...(branches.data?.branches ?? []).map((b) => ({ value: b.id, label: b.name })),
  ];
  const apply = (e: React.FormEvent) => {
    e.preventDefault();
    setApplied({ ...draft });
  };
  const applySegment = (f: CustomerFilters) => {
    setDraft(f);
    setApplied(f);
  };
  const label = (text: string, input: React.ReactNode) => (
    <div style={{ display: 'grid', gap: 4, fontSize: 12, color: C.mid }}>
      {text}
      {input}
    </div>
  );

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 8,
          margin: '0 0 16px',
        }}
      >
        <h1 style={{ fontSize: 22, fontWeight: 700, color: C.text, margin: 0 }}>Customers</h1>
        <button
          type="button"
          style={btn()}
          disabled={exportCsv.isPending}
          onClick={() => exportCsv.mutate()}
        >
          {exportCsv.isPending ? 'Exporting...' : 'Export CSV'}
        </button>
      </div>

      {(segments.data?.items.length ?? 0) > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {segments.data?.items.map((s) => (
            <span
              key={s.id}
              style={{
                display: 'inline-flex',
                border: `1px solid ${C.border2}`,
                borderRadius: 20,
                overflow: 'hidden',
                background: C.white,
              }}
            >
              <button
                type="button"
                onClick={() => applySegment(s.filters)}
                style={{ ...btn(), height: 32, border: 'none', background: 'transparent' }}
              >
                {s.name}
              </button>
              <button
                type="button"
                aria-label={`Delete segment ${s.name}`}
                onClick={() => deleteSegment.mutate(s.id)}
                style={{
                  ...btn(),
                  height: 32,
                  padding: '0 10px',
                  border: 'none',
                  background: 'transparent',
                  color: C.mid,
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <form onSubmit={apply} style={card}>
        <div
          style={{
            display: 'grid',
            gap: 12,
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          }}
        >
          {label(
            'Name or phone number',
            <input
              aria-label="Name or phone number"
              style={field}
              value={draft.q ?? ''}
              onChange={(e) => setDraft({ ...draft, q: e.target.value })}
            />,
          )}
          {label(
            'Branch',
            <PremiumSelect
              ariaLabel="Branch"
              fullWidth
              value={draft.branchId ?? ''}
              options={branchOptions}
              onChange={(v) => setDraft({ ...draft, branchId: String(v) || undefined })}
            />,
          )}
          {label(
            'Marketing consent',
            <PremiumSelect
              ariaLabel="Marketing consent"
              fullWidth
              value={draft.marketing}
              options={[
                { value: 'any', label: 'Any' },
                { value: 'yes', label: 'Agreed' },
                { value: 'no', label: 'Not agreed' },
              ]}
              onChange={(v) => setDraft({ ...draft, marketing: v as CustomerFilters['marketing'] })}
            />,
          )}
          {label(
            'Last visit from',
            <input
              aria-label="Last visit from"
              type="date"
              style={field}
              value={draft.lastVisitFrom ?? ''}
              onChange={(e) => setDraft({ ...draft, lastVisitFrom: e.target.value || undefined })}
            />,
          )}
          {label(
            'Last visit to',
            <input
              aria-label="Last visit to"
              type="date"
              style={field}
              value={draft.lastVisitTo ?? ''}
              onChange={(e) => setDraft({ ...draft, lastVisitTo: e.target.value || undefined })}
            />,
          )}
          {label(
            'Minimum visits',
            <input
              aria-label="Minimum visits"
              type="number"
              min={1}
              style={field}
              value={draft.minVisits ?? ''}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  minVisits: e.target.value ? Number(e.target.value) : undefined,
                })
              }
            />,
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          <button type="submit" style={btn(true)}>
            Apply
          </button>
          {hasFilters(draft) && (
            <button
              type="button"
              style={btn()}
              onClick={() => {
                setDraft(EMPTY_FILTERS);
                setApplied(EMPTY_FILTERS);
              }}
            >
              Clear
            </button>
          )}
          {hasFilters(applied) && (
            <span style={{ display: 'inline-flex', gap: 8, marginLeft: 'auto' }}>
              <input
                aria-label="Segment name"
                placeholder="Save as segment"
                style={{ ...field, width: 180 }}
                value={segmentName}
                maxLength={80}
                onChange={(e) => setSegmentName(e.target.value)}
              />
              <button
                type="button"
                style={btn()}
                disabled={!segmentName.trim() || saveSegment.isPending}
                onClick={() => saveSegment.mutate()}
              >
                Save
              </button>
            </span>
          )}
        </div>
      </form>

      <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
        <ListState
          status={list.status}
          isEmpty={rows.length === 0}
          emptyText={
            hasFilters(applied)
              ? 'No customers match these filters.'
              : 'No customers yet. They appear when shoppers share their WhatsApp number at the tablet.'
          }
          error={list.error instanceof Error ? list.error.message : null}
          onRetry={() => list.refetch()}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, minWidth: 640 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: C.mid }}>
                {['Name', 'Phone', 'Visits', 'Try-ons', 'Bought', 'Last visit', 'Marketing'].map(
                  (h) => (
                    <th key={h} scope="col" style={{ padding: '10px 12px', fontWeight: 600 }}>
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderTop: `1px solid ${C.border}` }}>
                  <td style={{ padding: '10px 12px' }}>
                    <button
                      type="button"
                      onClick={() => setOpenId(r.id)}
                      style={{
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        cursor: 'pointer',
                        color: C.text,
                        fontFamily: 'inherit',
                        fontSize: 14,
                        fontWeight: 600,
                        textDecoration: 'underline',
                      }}
                    >
                      {displayName(r.name)}
                    </button>
                  </td>
                  <td style={{ padding: '10px 12px', color: C.mid }}>{r.phone}</td>
                  <td style={{ padding: '10px 12px' }}>{r.visits}</td>
                  <td style={{ padding: '10px 12px' }}>{r.tryOns}</td>
                  <td style={{ padding: '10px 12px' }}>{r.purchases}</td>
                  <td style={{ padding: '10px 12px' }}>{dateOnly(r.lastSeenAt)}</td>
                  <td style={{ padding: '10px 12px' }}>{consentLabel(r.consents.marketing)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.hasNextPage && (
            <div style={{ padding: 12, textAlign: 'center' }}>
              <button
                type="button"
                style={btn()}
                disabled={list.isFetchingNextPage}
                onClick={() => list.fetchNextPage()}
              >
                {list.isFetchingNextPage ? 'Loading...' : 'Load more'}
              </button>
            </div>
          )}
        </ListState>
      </div>

      {openId && (
        <section aria-label="Customer profile" style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: C.text, margin: 0 }}>
              {profile.data ? displayName(profile.data.name) : 'Customer'}
            </h2>
            <button type="button" style={btn()} onClick={() => setOpenId(null)}>
              Close
            </button>
          </div>
          <ListState
            status={profile.status}
            isEmpty={false}
            emptyText=""
            error={profile.error instanceof Error ? profile.error.message : null}
            onRetry={() => profile.refetch()}
          >
            {profile.data && (
              <div style={{ color: C.text, fontSize: 14 }}>
                <p style={{ margin: '8px 0', color: C.mid }}>
                  +{profile.data.phone} · first seen {dateOnly(profile.data.firstSeenAt)} · last
                  seen {dateOnly(profile.data.lastSeenAt)}
                </p>
                <p style={{ margin: '8px 0' }}>
                  {profile.data.visits} visits, {profile.data.tryOns} try-ons,{' '}
                  {profile.data.purchases} bought. Looks:{' '}
                  {consentLabel(profile.data.consents.looks)}. Marketing:{' '}
                  {consentLabel(profile.data.consents.marketing)}.
                </p>
                <h3 style={{ fontSize: 14, margin: '16px 0 8px' }}>Visits</h3>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {profile.data.visitsList.map((v) => (
                    <li key={v.sessionId}>
                      {dateOnly(v.startedAt)}, {v.branchName}: tried {v.tried}, bought {v.sold}
                    </li>
                  ))}
                </ul>
                <h3 style={{ fontSize: 14, margin: '16px 0 8px' }}>Consent history</h3>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {profile.data.consentHistory.map((c) => (
                    <li key={`${c.kind}-${c.at}`}>
                      {dateOnly(c.at)}: {c.kind} {c.granted ? 'agreed' : 'withdrawn'} ({c.source},{' '}
                      {c.version})
                    </li>
                  ))}
                </ul>
                <div style={{ marginTop: 16 }}>
                  <button
                    type="button"
                    style={btn(false, true)}
                    onClick={() => setConfirmDelete(true)}
                  >
                    Delete customer
                  </button>
                </div>
              </div>
            )}
          </ListState>
        </section>
      )}

      <ConfirmDialog
        open={confirmDelete}
        danger
        title="Delete this customer?"
        body="Their phone number, name and all their in-store photos are permanently deleted. Visit counts stay as anonymous totals. This cannot be undone."
        confirmLabel="Delete"
        busy={remove.isPending}
        onConfirm={() => openId && remove.mutate(openId)}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
