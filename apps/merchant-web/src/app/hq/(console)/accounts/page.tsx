'use client';
import type { AccountListResponse } from '@aivastra/types';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { C } from '@/components/tokens';
import { PremiumSelect } from '@/components/ui/premium-select';
import { ListState } from '@/components/ui/state';
import { hqFetch } from '@/lib/hq-api';
import { accountHealth, relativeTime } from '@/lib/hq-format';

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
const HEALTH = {
  ok: { label: 'OK', color: C.text },
  watch: { label: 'Watch', color: '#b45309' },
  risk: { label: 'At risk', color: C.danger },
} as const;
const LIMIT = 25;

export default function AccountsPage() {
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [active, setActive] = useState('');
  const [sort, setSort] = useState('company');
  const [page, setPage] = useState(1);

  const q = useQuery({
    queryKey: ['hq', 'accounts', applied, active, sort, page],
    queryFn: () => {
      const p = new URLSearchParams({ sort, page: String(page), limit: String(LIMIT) });
      if (applied) p.set('search', applied);
      if (active) p.set('active', active);
      return hqFetch<AccountListResponse>(`/admin/accounts?${p}`);
    },
  });
  const rows = q.data?.items ?? [];
  const pages = Math.max(1, Math.ceil((q.data?.total ?? 0) / LIMIT));

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: C.text, margin: '0 0 16px' }}>Accounts</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setApplied(search.trim());
          setPage(1);
        }}
        style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}
      >
        <input
          aria-label="Search by company or email"
          placeholder="Search company or email"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...field, flex: '1 1 220px' }}
        />
        <PremiumSelect
          ariaLabel="Status"
          value={active}
          options={[
            { value: '', label: 'All accounts' },
            { value: 'true', label: 'Active' },
            { value: 'false', label: 'Inactive' },
          ]}
          onChange={(v) => {
            setActive(String(v));
            setPage(1);
          }}
        />
        <PremiumSelect
          ariaLabel="Sort"
          value={sort}
          options={[
            { value: 'company', label: 'Sort: company' },
            { value: 'balance', label: 'Sort: lowest credits' },
            { value: 'burn', label: 'Sort: highest 30-day use' },
            { value: 'activity', label: 'Sort: latest activity' },
          ]}
          onChange={(v) => {
            setSort(String(v));
            setPage(1);
          }}
        />
        <button
          type="submit"
          style={{
            height: 40,
            padding: '0 16px',
            borderRadius: 8,
            border: 'none',
            background: C.btnPrimary,
            color: C.white,
            fontFamily: 'inherit',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Search
        </button>
      </form>

      <div
        style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          overflowX: 'auto',
        }}
      >
        <ListState
          status={q.status}
          isEmpty={rows.length === 0}
          emptyText="No accounts match."
          error={q.error instanceof Error ? q.error.message : null}
          onRetry={() => q.refetch()}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, minWidth: 900 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: C.mid }}>
                {[
                  'Account',
                  'Health',
                  'Credits',
                  '30-day use',
                  'Branches',
                  'Tablets',
                  'Last activity',
                  'Channels',
                ].map((h) => (
                  <th key={h} scope="col" style={{ padding: '10px 12px', fontWeight: 600 }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => {
                const h = HEALTH[accountHealth(a)];
                const channels = [
                  a.channels.inStore && 'In-store',
                  a.channels.shopify && 'Shopify',
                  a.channels.apiKey && 'API',
                ].filter(Boolean);
                return (
                  <tr key={a.merchantId} style={{ borderTop: `1px solid ${C.border}` }}>
                    <td style={{ padding: '10px 12px' }}>
                      <Link
                        href={`/hq/accounts/${a.merchantId}`}
                        style={{ color: C.text, fontWeight: 600 }}
                      >
                        {a.companyName}
                      </Link>
                      <div style={{ fontSize: 12, color: C.mid }}>
                        {a.ownerEmail}
                        {!a.isActive && ' · inactive'}
                      </div>
                    </td>
                    <td style={{ padding: '10px 12px', color: h.color, fontWeight: 600 }}>
                      {h.label}
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      {a.creditBalance.toLocaleString('en-IN')}
                    </td>
                    <td style={{ padding: '10px 12px' }}>{a.burn30d.toLocaleString('en-IN')}</td>
                    <td style={{ padding: '10px 12px' }}>{a.branches}</td>
                    <td style={{ padding: '10px 12px' }}>
                      {a.devices}
                      {a.devicesOffline > 0 && (
                        <span style={{ color: '#b45309' }}> ({a.devicesOffline} offline)</span>
                      )}
                    </td>
                    <td style={{ padding: '10px 12px' }}>{relativeTime(a.lastActivityAt)}</td>
                    <td style={{ padding: '10px 12px', color: C.mid }}>
                      {channels.join(', ') || 'None'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ListState>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
        <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>
          Previous
        </button>
        <span style={{ fontSize: 13, color: C.mid }}>
          Page {page} of {pages} ({q.data?.total ?? 0} accounts)
        </span>
        <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)}>
          Next
        </button>
      </div>
    </div>
  );
}
