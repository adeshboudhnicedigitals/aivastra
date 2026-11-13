'use client';
import { useQuery } from '@tanstack/react-query';
import { Briefcase, Coins, Gauge, Users } from 'lucide-react';
import { useState } from 'react';
import { KpiCard } from '@/components/analytics/KpiCard';
import { useHq } from '@/components/hq/hq-session';
import {
  EmptyBox,
  ErrorBox,
  field,
  NoAccess,
  PageHead,
  Pager,
  td,
  th,
} from '@/components/hq/list-parts';
import { Modal } from '@/components/hq/modal';
import { SpendChart } from '@/components/hq/spend-chart';
import { btn, Fact, Pill, Skeleton } from '@/components/hq/ui';
import { C } from '@/components/tokens';
import { PremiumSelect } from '@/components/ui/premium-select';
import { hqFetch } from '@/lib/hq-api';

// A copy of admin-web's Credit analysis page: who spends credits, on what, over a period.
// Read-only. Same /admin/credit-analysis routes (credit_analysis.read).

type DayRange = '7' | '30' | '90' | 'all';
type Source = 'all' | 'catalog' | 'tryon' | 'saree' | 'shopify';
const SOURCE_LABELS: Record<Source, string> = {
  all: 'All sources',
  catalog: 'Catalog generation',
  tryon: 'Try-on (our app)',
  saree: 'Saree',
  shopify: 'Shopify try-on',
};
const DAY_OPTIONS = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: 'all', label: 'All time' },
];
const PAGE_SIZE = 20;

type UserRow = {
  id: string;
  email: string;
  displayName: string | null;
  tier: string;
  balance: number;
  hasShopifyStore: boolean;
  totalSpent: number;
  totalJobs: number;
  avgCostPerJob: number;
  lastActivityAt: string | null;
};
type Summary = { totalSpent: number; totalJobs: number; avgCostPerJob: number; totalUsers: number };
type LedgerEntry = {
  id: string;
  delta: number;
  reason: string;
  jobId: string | null;
  createdAt: string;
  source: Exclude<Source, 'all'> | null;
};
type Detail = {
  id: string;
  email: string;
  displayName: string | null;
  tier: string;
  balance: number;
  hasShopifyStore: boolean;
  dailySpend: { date: string; spent: number }[];
  ledger: LedgerEntry[];
  topProducts: {
    shopifyProductId: number;
    title: string | null;
    jobCount: number;
    creditsSpent: number;
  }[];
};

const n = (v: number) => v.toLocaleString('en-IN');
const when = (v: string | null) =>
  v ? new Date(v).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

/** One plain line per ledger row, so nobody has to decode reason codes. */
function describe(l: LedgerEntry): { title: string; subtitle: string } {
  const src = l.source ? SOURCE_LABELS[l.source] : null;
  if (l.reason === 'JOB_DISPATCH')
    return { title: src ? `${src} job` : 'Job completed', subtitle: 'Job dispatch' };
  if (l.reason === 'UNLIMITED_PLAN_USAGE')
    return { title: src ? `${src} job` : 'Unlimited plan job', subtitle: 'Unlimited plan usage' };
  if (l.reason.startsWith('REFUND'))
    return {
      title: src ? `${src} refund` : 'Credit refund',
      subtitle: l.reason.replace('REFUND_', '').replace(/_/g, ' ').toLowerCase(),
    };
  if (l.reason.includes('MANUAL'))
    return { title: 'Manual adjustment', subtitle: 'Admin credit change' };
  return {
    title: l.reason
      .replace(/_/g, ' ')
      .toLowerCase()
      .replace(/^\w/, (c) => c.toUpperCase()),
    subtitle: src ?? 'Account activity',
  };
}

const selectBox: React.CSSProperties = {
  flex: '0 1 200px',
  minWidth: 160,
  height: 40,
  borderRadius: 8,
  border: `1px solid ${C.border2}`,
  background: C.field,
};

export default function CreditAnalysisPage() {
  const { can } = useHq();
  if (!can('credit_analysis.read')) return <NoAccess what="credit analysis" />;
  return <Analysis />;
}

function Analysis() {
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [days, setDays] = useState<DayRange>('30');
  const [source, setSource] = useState<Source>('all');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['hq', 'credit-analysis', applied, days, source, page],
    queryFn: () => {
      const p = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
        days,
        source,
      });
      if (applied) p.set('search', applied);
      return hqFetch<{ items: UserRow[]; total: number; summary: Summary }>(
        `/admin/credit-analysis/users?${p}`,
      );
    },
    placeholderData: (prev) => prev,
  });
  const detail = useQuery({
    queryKey: ['hq', 'credit-analysis', 'user', openId, days, source],
    queryFn: () =>
      hqFetch<Detail>(
        `/admin/credit-analysis/users/${openId}?${new URLSearchParams({ days, source })}`,
      ),
    enabled: openId !== null,
  });

  const rows = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const s = list.data?.summary;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const periodHint = DAY_OPTIONS.find((o) => o.value === days)?.label ?? '';
  const d = detail.data;

  return (
    <div>
      <PageHead
        title="Credit analysis"
        lede="Who spends credits, on what, and how much they have left. Completed jobs only."
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
          gap: 12,
          marginBottom: 16,
        }}
      >
        <KpiCard
          label="Credits spent"
          value={s ? n(s.totalSpent) : '—'}
          hint={periodHint}
          loading={list.isPending}
          icon={<Coins size={16} aria-hidden="true" />}
        />
        <KpiCard
          label="Jobs completed"
          value={s ? n(s.totalJobs) : '—'}
          hint={periodHint}
          loading={list.isPending}
          icon={<Briefcase size={16} aria-hidden="true" />}
        />
        <KpiCard
          label="Credits per job"
          value={s ? String(s.avgCostPerJob) : '—'}
          hint="Average"
          loading={list.isPending}
          icon={<Gauge size={16} aria-hidden="true" />}
        />
        <KpiCard
          label="Active users"
          value={s ? n(s.totalUsers) : '—'}
          hint="Spent in this period"
          loading={list.isPending}
          icon={<Users size={16} aria-hidden="true" />}
        />
      </div>

      <search>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setApplied(search.trim());
            setPage(1);
          }}
          style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}
        >
          <input
            aria-label="Search by name or email"
            type="search"
            placeholder="Search name or email"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ ...field, flex: '1 1 240px' }}
          />
          <div style={selectBox}>
            <PremiumSelect
              fullWidth
              height={38}
              fontSize={14}
              ariaLabel="Period"
              value={days}
              options={DAY_OPTIONS}
              onChange={(v) => {
                setDays(String(v) as DayRange);
                setPage(1);
              }}
            />
          </div>
          <div style={selectBox}>
            <PremiumSelect
              fullWidth
              height={38}
              fontSize={14}
              ariaLabel="Source"
              value={source}
              options={(Object.keys(SOURCE_LABELS) as Source[]).map((k) => ({
                value: k,
                label: SOURCE_LABELS[k],
              }))}
              onChange={(v) => {
                setSource(String(v) as Source);
                setPage(1);
              }}
            />
          </div>
          <button type="submit" style={btn.primary}>
            Search
          </button>
          {applied !== '' && (
            <button
              type="button"
              style={btn.base}
              onClick={() => {
                setSearch('');
                setApplied('');
                setPage(1);
              }}
            >
              Clear search
            </button>
          )}
        </form>
      </search>

      {list.isError ? (
        <ErrorBox what="credit analysis" error={list.error} onRetry={() => void list.refetch()} />
      ) : list.isPending ? (
        <div style={{ display: 'grid', gap: 10 }} aria-busy="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} h={52} />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyBox>No spending found for these filters.</EmptyBox>
      ) : (
        <>
          <div
            className="hq-table hq-card"
            style={{ overflowX: 'auto', opacity: list.isPlaceholderData ? 0.6 : 1 }}
          >
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <caption className="sr-only">Credit spend by user</caption>
              <thead>
                <tr style={{ color: C.mid, fontSize: 12 }}>
                  <th scope="col" style={th}>
                    User
                  </th>
                  <th scope="col" style={th}>
                    Access
                  </th>
                  <th scope="col" style={{ ...th, textAlign: 'right' }}>
                    Balance
                  </th>
                  <th scope="col" style={{ ...th, textAlign: 'right' }}>
                    Spent
                  </th>
                  <th scope="col" style={{ ...th, textAlign: 'right' }}>
                    Jobs
                  </th>
                  <th scope="col" style={{ ...th, textAlign: 'right' }}>
                    Per job
                  </th>
                  <th scope="col" style={th}>
                    Last activity
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="hq-row" style={{ borderTop: `1px solid ${C.border}` }}>
                    <td style={td}>
                      <button
                        type="button"
                        onClick={() => setOpenId(r.id)}
                        style={{
                          all: 'unset',
                          cursor: 'pointer',
                          color: C.text,
                          fontWeight: 700,
                        }}
                      >
                        {r.displayName ?? r.email}
                      </button>
                      <div style={{ fontSize: 12, color: C.mid, overflowWrap: 'anywhere' }}>
                        {r.displayName ? r.email : ''}
                        {r.hasShopifyStore ? `${r.displayName ? ' · ' : ''}Shopify store` : ''}
                      </div>
                    </td>
                    <td style={{ ...td, textTransform: 'capitalize' }}>{r.tier}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{n(r.balance)}</td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>
                      {n(r.totalSpent)}
                    </td>
                    <td style={{ ...td, textAlign: 'right' }}>{n(r.totalJobs)}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{r.avgCostPerJob}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{when(r.lastActivityAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="hq-cards" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {rows.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className="hq-card hq-card--link"
                  onClick={() => setOpenId(r.id)}
                  style={{
                    display: 'grid',
                    gap: 6,
                    width: '100%',
                    padding: 14,
                    textAlign: 'left',
                    fontFamily: 'inherit',
                    color: C.text,
                    cursor: 'pointer',
                  }}
                >
                  <strong style={{ overflowWrap: 'anywhere' }}>{r.displayName ?? r.email}</strong>
                  <span style={{ fontSize: 13, color: C.mid }}>
                    Spent {n(r.totalSpent)} · {n(r.totalJobs)} jobs · Balance {n(r.balance)}
                  </span>
                  <span style={{ fontSize: 12, color: C.mid }}>{when(r.lastActivityAt)}</span>
                </button>
              </li>
            ))}
          </ul>
          <Pager page={page} pages={pages} onPage={setPage} />
        </>
      )}

      <Modal
        open={openId !== null}
        title="User credit detail"
        width={720}
        onClose={() => setOpenId(null)}
      >
        {detail.isError ? (
          <ErrorBox what="this user" error={detail.error} onRetry={() => void detail.refetch()} />
        ) : !d ? (
          <div style={{ display: 'grid', gap: 10 }} aria-busy="true">
            <Skeleton h={28} w="60%" />
            <Skeleton h={120} />
          </div>
        ) : (
          <>
            <div>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>
                {d.displayName ?? d.email}
              </h2>
              <div style={{ color: C.mid, overflowWrap: 'anywhere' }}>{d.email}</div>
            </div>
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
              <Fact label="Balance">{n(d.balance)} credits</Fact>
              <Fact label={`Spent (${periodHint.toLowerCase()})`}>
                {n(d.dailySpend.reduce((a, p) => a + p.spent, 0))} credits
              </Fact>
              <Fact label="Access">
                <span style={{ textTransform: 'capitalize' }}>{d.tier}</span>
              </Fact>
              <Fact label="Source">{SOURCE_LABELS[source]}</Fact>
            </div>

            <section aria-label="Daily credit spend">
              <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>Daily credit spend</h3>
              {d.dailySpend.length > 0 ? (
                <SpendChart points={d.dailySpend} />
              ) : (
                <p style={{ margin: 0, color: C.mid }}>No spend in this period.</p>
              )}
            </section>

            {d.hasShopifyStore && (
              <section aria-label="Top Shopify products">
                <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>Top Shopify products</h3>
                {d.topProducts.length === 0 ? (
                  <p style={{ margin: 0, color: C.mid }}>No product activity in this period.</p>
                ) : (
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
                    {d.topProducts.map((p) => (
                      <li
                        key={p.shopifyProductId}
                        style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}
                      >
                        <span style={{ overflowWrap: 'anywhere' }}>
                          {p.title ?? `Product ${p.shopifyProductId}`}
                        </span>
                        <span style={{ color: C.mid, whiteSpace: 'nowrap' }}>
                          {n(p.jobCount)} jobs · {n(p.creditsSpent)} credits
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            <section aria-label="Recent credit activity">
              <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>Recent activity (latest 50)</h3>
              {d.ledger.length === 0 ? (
                <p style={{ margin: 0, color: C.mid }}>No activity in this period.</p>
              ) : (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {d.ledger.map((l) => {
                    const t = describe(l);
                    return (
                      <li
                        key={l.id}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          gap: 12,
                          padding: '8px 0',
                          borderTop: `1px solid ${C.border}`,
                        }}
                      >
                        <span>
                          <span style={{ fontWeight: 600 }}>{t.title}</span>
                          <span style={{ display: 'block', fontSize: 12, color: C.mid }}>
                            {t.subtitle} · {when(l.createdAt)}
                          </span>
                        </span>
                        <Pill tone={l.delta < 0 ? 'muted' : 'ok'}>
                          {l.delta > 0 ? '+' : ''}
                          {n(l.delta)}
                        </Pill>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" style={btn.base} onClick={() => setOpenId(null)}>
            Close
          </button>
        </div>
      </Modal>
    </div>
  );
}
