import { useCallback, useEffect, useState } from 'react';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { Icon } from '../components/Icons';
import { Pager } from '../components/Pager';
import { apiErrorMessage, apiFetch } from '../lib/data';

type DayRange = '7' | '30' | '90' | 'all';
type SourceFilter = 'all' | 'catalog' | 'tryon' | 'saree' | 'kiosk' | 'shopify';

const SOURCE_LABELS: Record<SourceFilter, string> = {
  all: 'All sources',
  catalog: 'Catalog generation',
  tryon: 'Tryon (our app)',
  saree: 'Saree',
  kiosk: 'Kiosk',
  shopify: 'Shopify tryon',
};

interface CreditUserRow {
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
}

interface DailySpendPoint {
  date: string;
  spent: number;
}

type JobSource = Exclude<SourceFilter, 'all'>;

interface LedgerEntry {
  id: string;
  delta: number;
  reason: string;
  jobId: string | null;
  createdAt: string;
  source: JobSource | null;
}

const SOURCE_TAG_COLORS: Record<JobSource, string> = {
  catalog: '#8a7cff',
  tryon: '#4caf50',
  saree: '#e08e45',
  kiosk: '#5aa9e6',
  shopify: '#95bf47',
};

interface TopProduct {
  shopifyProductId: number;
  title: string | null;
  jobCount: number;
  creditsSpent: number;
}

interface CreditUserDetail {
  id: string;
  email: string;
  displayName: string | null;
  tier: string;
  balance: number;
  hasShopifyStore: boolean;
  dailySpend: DailySpendPoint[];
  ledger: LedgerEntry[];
  topProducts: TopProduct[];
}

const PAGE_SIZE = 20;

interface Props {
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
}

export default function CreditAnalysisPage({ toast }: Props) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [days, setDays] = useState<DayRange>('30');
  const [source, setSource] = useState<SourceFilter>('all');
  const [rows, setRows] = useState<CreditUserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CreditUserDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page + 1),
        pageSize: String(PAGE_SIZE),
        days,
        source,
      });
      if (query) params.set('search', query);
      const data = await apiFetch<{ items: CreditUserRow[]; total: number }>(
        `/admin/credit-analysis/users?${params}`,
      );
      setRows(data.items);
      setTotal(data.total);
    } catch (err) {
      toast({
        kind: 'error',
        title: 'Failed to load credit analysis',
        body: apiErrorMessage(err, 'Please try again.'),
      });
    } finally {
      setLoading(false);
    }
  }, [page, query, days, source, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const openDetail = (id: string) => {
    setDetailId(id);
  };

  useEffect(() => {
    if (!detailId) return;
    let cancelled = false;
    setDetail(null);
    setDetailLoading(true);
    (async () => {
      try {
        const params = new URLSearchParams({ days, source });
        const data = await apiFetch<CreditUserDetail>(
          `/admin/credit-analysis/users/${detailId}?${params}`,
        );
        if (!cancelled) setDetail(data);
      } catch (err) {
        if (!cancelled) {
          toast({
            kind: 'error',
            title: 'Failed to load user detail',
            body: apiErrorMessage(err, 'Please try again.'),
          });
          setDetailId(null);
        }
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Re-fetches whenever the opened user, or the day-range/source filter, changes —
    // this is what lets changing the filter while a detail view is open refresh it.
  }, [detailId, days, source, toast]);

  const handleSearch = (q: string) => {
    setQuery(q);
    setPage(0);
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  if (detailId) {
    return (
      <>
        <div className="page-head">
          <div>
            <button className="btn ghost" onClick={() => setDetailId(null)}>
              <Icon.Back /> Back to credit analysis
            </button>
            {detail && (
              <>
                <h1 style={{ marginTop: 8 }}>{detail.displayName ?? detail.email}</h1>
                <p className="lede">
                  {detail.email} &middot; {detail.tier}
                </p>
              </>
            )}
          </div>
          <div className="head-tools">
            {detail?.hasShopifyStore && (
              <span
                className="badge dot"
                style={{ background: 'rgba(76,175,80,0.12)', color: 'var(--success, #4caf50)' }}
              >
                Shopify
              </span>
            )}
          </div>
        </div>

        {detailLoading || !detail ? (
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>Loading&hellip;</p>
        ) : (
          <>
            <div
              className="kv-grid"
              style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 20 }}
            >
              <div className="kv">
                <span className="k">Balance</span>
                <span className="v">{detail.balance.toLocaleString()}</span>
              </div>
              <div className="kv">
                <span className="k">Ledger entries shown</span>
                <span className="v">{detail.ledger.length}</span>
              </div>
              <div className="kv">
                <span className="k">Filter</span>
                <span className="v">
                  {days === 'all' ? 'All time' : `${days}d`} &middot; {SOURCE_LABELS[source]}
                </span>
              </div>
            </div>

            <div className="card" style={{ marginBottom: 20 }}>
              <div className="card-head">
                <h3>Daily spend</h3>
              </div>
              <div className="card-body">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={detail.dailySpend}>
                    <XAxis
                      dataKey="date"
                      stroke="var(--muted)"
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip
                      cursor={{ fill: 'rgba(128,128,128,0.08)' }}
                      contentStyle={{
                        background: 'var(--surface-2)',
                        border: '1px solid var(--border)',
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                    <Bar dataKey="spent" fill="var(--accent)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {detail.hasShopifyStore && (
              <div className="card" style={{ marginBottom: 20 }}>
                <div className="card-head">
                  <h3>Top products</h3>
                </div>
                <div className="card-body" style={{ padding: 0 }}>
                  {detail.topProducts.length ? (
                    <div className="table-wrap">
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Product</th>
                            <th style={{ textAlign: 'right' }}>Try-ons</th>
                            <th style={{ textAlign: 'right' }}>Credits spent</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.topProducts.map((p) => (
                            <tr key={p.shopifyProductId}>
                              <td>{p.title ?? `Product #${p.shopifyProductId}`}</td>
                              <td style={{ textAlign: 'right' }}>
                                <span className="mono">{p.jobCount}</span>
                              </td>
                              <td style={{ textAlign: 'right' }}>
                                <span className="mono">{p.creditsSpent}</span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div style={{ padding: 20, color: 'var(--muted)', fontSize: 13 }}>
                      No product try-ons in this window.
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="card">
              <div className="card-head">
                <h3>Recent ledger entries</h3>
                <select
                  className="select"
                  value={source}
                  onChange={(e) => {
                    setSource(e.target.value as SourceFilter);
                    setPage(0);
                  }}
                  style={{ marginLeft: 'auto', fontSize: 12, padding: '4px 8px' }}
                >
                  {(Object.keys(SOURCE_LABELS) as SourceFilter[]).map((s) => (
                    <option key={s} value={s}>
                      {SOURCE_LABELS[s]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="card-body" style={{ padding: 0 }}>
                {detail.ledger.length ? (
                  detail.ledger.map((l) => (
                    <div
                      key={l.id}
                      style={{
                        padding: '10px 18px',
                        borderBottom: '1px solid var(--border)',
                        display: 'flex',
                        gap: 10,
                        alignItems: 'center',
                      }}
                    >
                      <span
                        className="mono"
                        style={{ color: l.delta < 0 ? 'var(--danger)' : 'var(--success, #4caf50)' }}
                      >
                        {l.delta > 0 ? '+' : ''}
                        {l.delta}
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--muted)' }}>{l.reason}</span>
                      {l.source ? (
                        <span
                          className="badge dot"
                          style={{
                            background: `${SOURCE_TAG_COLORS[l.source]}1f`,
                            color: SOURCE_TAG_COLORS[l.source],
                            fontSize: 10,
                          }}
                        >
                          {SOURCE_LABELS[l.source]}
                        </span>
                      ) : (
                        <span
                          className="badge dot"
                          style={{ background: 'var(--bg-2)', color: 'var(--muted)', fontSize: 10 }}
                        >
                          Account
                        </span>
                      )}
                      <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 'auto' }}>
                        {new Date(l.createdAt).toLocaleString()}
                      </span>
                    </div>
                  ))
                ) : (
                  <div style={{ padding: 20, color: 'var(--muted)', fontSize: 13 }}>
                    No ledger entries in this window.
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </>
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Credit Analysis</h1>
          <p className="lede">{loading ? '…' : total} users ranked by credit spend.</p>
        </div>
        <div className="head-tools">
          <div className="search">
            <Icon.Search />
            <input
              placeholder="Search by name or email…"
              value={query}
              onChange={(e) => handleSearch(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          marginBottom: 16,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', gap: 4 }}>
          {(['7', '30', '90', 'all'] as DayRange[]).map((d) => (
            <button
              key={d}
              className="btn sm ghost"
              onClick={() => {
                setDays(d);
                setPage(0);
              }}
              style={{
                background: days === d ? 'var(--bg-2)' : 'transparent',
                color: days === d ? 'var(--text)' : 'var(--muted)',
              }}
            >
              {d === 'all' ? 'All time' : `${d}d`}
            </button>
          ))}
        </div>
        <select
          className="select"
          value={source}
          onChange={(e) => {
            setSource(e.target.value as SourceFilter);
            setPage(0);
          }}
        >
          {(Object.keys(SOURCE_LABELS) as SourceFilter[]).map((s) => (
            <option key={s} value={s}>
              {SOURCE_LABELS[s]}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <p style={{ color: 'var(--muted)', fontSize: 13, padding: '20px 0' }}>Loading&hellip;</p>
      ) : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>User</th>
                  <th style={{ textAlign: 'right' }}>Spent</th>
                  <th style={{ textAlign: 'right' }}>Jobs</th>
                  <th style={{ textAlign: 'right' }}>Avg/job</th>
                  <th style={{ textAlign: 'right' }}>Last activity</th>
                  <th style={{ textAlign: 'right' }}>Balance</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} onClick={() => openDetail(r.id)} style={{ cursor: 'pointer' }}>
                    <td style={{ textAlign: 'left' }}>
                      <span
                        className="semi"
                        style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                      >
                        {r.displayName ?? <span style={{ color: 'var(--muted)' }}>{r.email}</span>}
                        {r.hasShopifyStore && (
                          <span
                            className="badge dot"
                            style={{
                              background: 'rgba(76,175,80,0.12)',
                              color: 'var(--success, #4caf50)',
                              fontSize: 10,
                            }}
                          >
                            Shopify
                          </span>
                        )}
                      </span>
                      {r.displayName && (
                        <span className="sub" style={{ display: 'block' }}>
                          {r.email}
                        </span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <span className="mono">{r.totalSpent.toLocaleString()}</span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <span className="mono">{r.totalJobs.toLocaleString()}</span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <span className="mono">{r.avgCostPerJob}</span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <span className="mono">
                        {r.lastActivityAt ? new Date(r.lastActivityAt).toLocaleDateString() : '—'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <span className="mono">{r.balance.toLocaleString()}</span>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      style={{
                        padding: 20,
                        color: 'var(--muted)',
                        fontSize: 13,
                        textAlign: 'center',
                      }}
                    >
                      No users found for this filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <Pager
            page={page}
            totalPages={totalPages}
            onPage={setPage}
            totalItems={total}
            pageSize={PAGE_SIZE}
          />
        </>
      )}
    </>
  );
}
