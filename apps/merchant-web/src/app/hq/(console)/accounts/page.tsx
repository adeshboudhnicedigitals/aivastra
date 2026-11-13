'use client';
import type { AccountListResponse, AccountRow } from '@aivastra/types';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Avatar, btn, Pill, Skeleton, type Tone } from '@/components/hq/ui';
import { C } from '@/components/tokens';
import { PremiumSelect } from '@/components/ui/premium-select';
import { hqFetch } from '@/lib/hq-api';
import { accountHealth, relativeTime, runwayLabel } from '@/lib/hq-format';

const LIMIT = 25;
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
const selectBox: React.CSSProperties = {
  flex: '0 1 190px',
  minWidth: 150,
  height: 40,
  borderRadius: 8,
  border: `1px solid ${C.border2}`,
  background: C.field,
};
const HEALTH: Record<'ok' | 'watch' | 'risk', { tone: Tone; label: string }> = {
  ok: { tone: 'ok', label: 'Healthy' },
  watch: { tone: 'warn', label: 'Needs a look' },
  risk: { tone: 'bad', label: 'At risk' },
};
const n = (v: number) => v.toLocaleString('en-IN');

function channelsOf(a: AccountRow): string {
  return (
    [a.channels.inStore && 'In-store', a.channels.shopify && 'Shopify', a.channels.apiKey && 'API']
      .filter(Boolean)
      .join(' · ') || 'No channel yet'
  );
}

function Why({ a }: { a: AccountRow }) {
  // One plain sentence for why a row is not "Healthy", so nobody has to decode the numbers.
  const h = accountHealth(a);
  if (h === 'ok') return null;
  const bits: string[] = [];
  if (a.devices > 0 && a.creditBalance <= 0) bits.push('Out of credits');
  else if (h === 'watch' && a.burn30d > 0 && a.creditBalance < (a.burn30d / 30) * 7)
    bits.push('Low credits');
  if (a.devices > 0 && a.devicesOffline === a.devices) bits.push('All tablets offline');
  else if (a.devicesOffline > 0) bits.push(`${a.devicesOffline} tablet(s) offline`);
  return <div style={{ fontSize: 12, color: C.mid, marginTop: 4 }}>{bits.join(' · ')}</div>;
}

export default function AccountsPage() {
  const router = useRouter();
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
    placeholderData: (prev) => prev,
  });
  const rows = q.data?.items ?? [];
  const total = q.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / LIMIT));
  const filtered = applied !== '' || active !== '';

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setApplied(search.trim());
    setPage(1);
  };
  const clear = () => {
    setSearch('');
    setApplied('');
    setActive('');
    setPage(1);
  };

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h1
          style={{
            fontSize: 22,
            fontWeight: 700,
            color: C.text,
            margin: 0,
          }}
        >
          Accounts
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: 14, color: C.mid }}>
          Every retailer account, with credits, tablets and recent activity. Open one to manage it.
        </p>
      </div>

      <search>
        <form
          onSubmit={submit}
          style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}
        >
          <input
            aria-label="Search by company or email"
            type="search"
            placeholder="Search company or email"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ ...field, flex: '1 1 240px' }}
          />
          <div style={selectBox}>
            <PremiumSelect
              fullWidth
              height={38}
              fontSize={14}
              ariaLabel="Status"
              value={active}
              options={[
                { value: '', label: 'All accounts' },
                { value: 'true', label: 'Active only' },
                { value: 'false', label: 'Inactive only' },
              ]}
              onChange={(v) => {
                setActive(String(v));
                setPage(1);
              }}
            />
          </div>
          <div style={selectBox}>
            <PremiumSelect
              fullWidth
              height={38}
              fontSize={14}
              ariaLabel="Sort"
              value={sort}
              options={[
                { value: 'company', label: 'Company A–Z' },
                { value: 'balance', label: 'Lowest credits first' },
                { value: 'burn', label: 'Highest 30-day use' },
                { value: 'activity', label: 'Latest activity' },
              ]}
              onChange={(v) => {
                setSort(String(v));
                setPage(1);
              }}
            />
          </div>
          <button type="submit" style={btn.primary}>
            Search
          </button>
          {filtered && (
            <button type="button" style={btn.base} onClick={clear}>
              Clear filters
            </button>
          )}
        </form>
      </search>

      <div
        aria-live="polite"
        style={{ fontSize: 13, color: C.mid, marginBottom: 8, minHeight: 18 }}
      >
        {q.isSuccess && `${n(total)} account${total === 1 ? '' : 's'}${filtered ? ' match' : ''}`}
      </div>

      {q.isError ? (
        <div
          role="alert"
          style={{
            background: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: 14,
            padding: 20,
          }}
        >
          <strong style={{ color: C.text }}>Could not load accounts.</strong>
          <p style={{ margin: '6px 0 12px', fontSize: 14, color: C.mid }}>
            {q.error instanceof Error ? q.error.message : 'Check your connection and try again.'}
          </p>
          <button type="button" style={btn.base} onClick={() => void q.refetch()}>
            Try again
          </button>
        </div>
      ) : q.isPending ? (
        <div style={{ display: 'grid', gap: 10 }} aria-busy="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} h={56} />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div
          style={{
            background: C.card,
            border: `1px dashed ${C.border2}`,
            borderRadius: 14,
            padding: 32,
            textAlign: 'center',
            color: C.mid,
          }}
        >
          {filtered ? 'No accounts match those filters.' : 'No accounts yet.'}
          {filtered && (
            <div style={{ marginTop: 12 }}>
              <button type="button" style={btn.base} onClick={clear}>
                Clear filters
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
          <div
            className="hq-table hq-card"
            style={{
              overflowX: 'auto',
              opacity: q.isPlaceholderData ? 0.6 : 1,
            }}
          >
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <caption style={{ position: 'absolute', left: -9999 }}>Accounts</caption>
              <thead>
                <tr style={{ textAlign: 'left', color: C.mid, fontSize: 12 }}>
                  {[
                    'Account',
                    'Status',
                    'Credits',
                    'Last 30 days',
                    'Tablets',
                    'Last activity',
                    'Channels',
                  ].map((h) => (
                    <th
                      key={h}
                      scope="col"
                      style={{
                        padding: '12px 14px',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: 0.5,
                        borderBottom: `1px solid ${C.border}`,
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => {
                  const h = HEALTH[accountHealth(a)];
                  return (
                    <tr
                      key={a.merchantId}
                      className="hq-row"
                      onClick={() => router.push(`/hq/accounts/${a.merchantId}`)}
                      style={{ borderTop: `1px solid ${C.border}`, cursor: 'pointer' }}
                    >
                      <td style={{ padding: '12px 14px', minWidth: 200 }}>
                        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                          <Avatar name={a.companyName} />
                          <div style={{ minWidth: 0 }}>
                            <Link
                              href={`/hq/accounts/${a.merchantId}`}
                              onClick={(e) => e.stopPropagation()}
                              style={{ color: C.text, fontWeight: 700, textDecoration: 'none' }}
                            >
                              {a.companyName}
                            </Link>
                            <div style={{ fontSize: 12, color: C.mid }}>{a.ownerEmail}</div>
                            <Why a={a} />
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: '12px 14px' }}>
                        {a.isActive ? (
                          <Pill tone={h.tone}>{h.label}</Pill>
                        ) : (
                          <Pill tone="muted">Inactive</Pill>
                        )}
                      </td>
                      <td style={{ padding: '12px 14px' }}>
                        <div style={{ fontWeight: 700 }}>{n(a.creditBalance)}</div>
                        <div style={{ fontSize: 12, color: C.mid }}>
                          {runwayLabel(a.creditBalance, a.burn30d)}
                        </div>
                      </td>
                      <td style={{ padding: '12px 14px' }}>{n(a.burn30d)} used</td>
                      <td style={{ padding: '12px 14px' }}>
                        {a.devices === 0 ? (
                          <span style={{ color: C.mid }}>None</span>
                        ) : (
                          <>
                            {a.devices - a.devicesOffline} of {a.devices} online
                          </>
                        )}
                        <div style={{ fontSize: 12, color: C.mid }}>
                          {a.branches} branch{a.branches === 1 ? '' : 'es'}
                        </div>
                      </td>
                      <td style={{ padding: '12px 14px', whiteSpace: 'nowrap' }}>
                        {relativeTime(a.lastActivityAt)}
                      </td>
                      <td style={{ padding: '12px 14px', color: C.mid }}>{channelsOf(a)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <ul className="hq-cards" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {rows.map((a) => {
              const h = HEALTH[accountHealth(a)];
              return (
                <li key={a.merchantId}>
                  <Link
                    href={`/hq/accounts/${a.merchantId}`}
                    className="hq-card hq-card--link"
                    style={{
                      display: 'block',
                      padding: 14,
                      textDecoration: 'none',
                      color: C.text,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <strong style={{ overflowWrap: 'anywhere' }}>{a.companyName}</strong>
                      {a.isActive ? (
                        <Pill tone={h.tone}>{h.label}</Pill>
                      ) : (
                        <Pill tone="muted">Inactive</Pill>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: C.mid, overflowWrap: 'anywhere' }}>
                      {a.ownerEmail}
                    </div>
                    <Why a={a} />
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: 8,
                        marginTop: 10,
                        fontSize: 13,
                      }}
                    >
                      <span>
                        <span style={{ color: C.mid }}>Credits </span>
                        <strong>{n(a.creditBalance)}</strong>
                      </span>
                      <span>
                        <span style={{ color: C.mid }}>Tablets </span>
                        <strong>
                          {a.devices - a.devicesOffline}/{a.devices}
                        </strong>
                      </span>
                      <span style={{ color: C.mid, gridColumn: '1 / -1' }}>
                        {runwayLabel(a.creditBalance, a.burn30d)} · {relativeTime(a.lastActivityAt)}
                      </span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>

          <nav
            aria-label="Pagination"
            style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 14 }}
          >
            <button
              type="button"
              style={{ ...btn.base, opacity: page <= 1 ? 0.5 : 1 }}
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </button>
            <span style={{ fontSize: 13, color: C.mid }}>
              Page {page} of {pages}
            </span>
            <button
              type="button"
              style={{ ...btn.base, opacity: page >= pages ? 0.5 : 1 }}
              disabled={page >= pages}
              onClick={() => setPage(page + 1)}
            >
              Next
            </button>
          </nav>
        </>
      )}
    </div>
  );
}
