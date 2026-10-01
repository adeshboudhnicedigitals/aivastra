import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { Icon } from '../components/Icons';
import { Pager } from '../components/Pager';
import { useCrumb } from '../context/BreadcrumbContext';
import { useCloseOverlay } from '../hooks/use-close-overlay';
import { useUrlState, useUrlStateMulti } from '../hooks/use-url-state';
import { apiErrorMessage, apiFetch } from '../lib/data';

const DETAIL_OVERLAY_KEYS = ['user'] as const;
const ACCORDION_OVERLAY_KEYS = ['expanded', 'expandedSubtab'] as const;

type DayRange = '7' | '30' | '90' | 'all';
type SourceFilter = 'all' | 'catalog' | 'tryon' | 'saree' | 'shopify';

const SOURCE_LABELS: Record<SourceFilter, string> = {
  all: 'All sources',
  catalog: 'Catalog generation',
  tryon: 'Tryon (our app)',
  saree: 'Saree',
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

function formatActivity(l: LedgerEntry): { title: string; subtitle: string } {
  const sourceName = l.source ? SOURCE_LABELS[l.source] : null;

  if (l.reason === 'JOB_DISPATCH') {
    return {
      title: sourceName ? `${sourceName} job` : 'Job completed',
      subtitle: 'Job dispatch',
    };
  }

  if (l.reason === 'UNLIMITED_PLAN_USAGE') {
    return {
      title: sourceName ? `${sourceName} job` : 'Unlimited plan job',
      subtitle: 'Unlimited plan usage',
    };
  }

  if (l.reason.startsWith('REFUND')) {
    return {
      title: sourceName ? `${sourceName} refund` : 'Credit refund',
      subtitle: l.reason.replace('REFUND_', '').replace(/_/g, ' ').toLowerCase(),
    };
  }

  if (l.reason.includes('MANUAL')) {
    return {
      title: 'Manual adjustment',
      subtitle: 'Admin credit change',
    };
  }

  const cleanReason = l.reason
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase());

  return {
    title: cleanReason,
    subtitle: sourceName ?? 'Account activity',
  };
}

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

interface CreditSummary {
  totalSpent: number;
  totalJobs: number;
  avgCostPerJob: number;
  totalUsers: number;
}

const PAGE_SIZE = 20;

interface Props {
  onNav?: (_page: string, _filter?: { page: string; filter?: string }) => void;
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
}

export default function CreditAnalysisPage({ onNav: _onNav, toast }: Props) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [days, setDays] = useState<DayRange>('30');
  const [source, setSource] = useState<SourceFilter>('all');
  const [rows, setRows] = useState<CreditUserRow[]>([]);
  const [summary, setSummary] = useState<CreditSummary | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const [detailId, setDetailId] = useUrlState('user');
  const closeDetail = useCloseOverlay(DETAIL_OVERLAY_KEYS);
  const [detail, setDetail] = useState<CreditUserDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const loadedDetailIdRef = useRef<string | null>(null);

  const closeDetailRef = useRef(closeDetail);
  closeDetailRef.current = closeDetail;

  const toastRef = useRef(toast);
  toastRef.current = toast;

  const [isNavOpen, setIsNavOpen] = useState(false);
  const [{ expanded: expandedUserId, expandedSubtab }, setAccordionParams] =
    useUrlStateMulti(ACCORDION_OVERLAY_KEYS);
  const closeAccordion = useCloseOverlay(ACCORDION_OVERLAY_KEYS);
  const activeSubTab =
    expandedSubtab === 'graph' || expandedSubtab === 'ledger' ? expandedSubtab : null;
  const [showAllLedgerMap, setShowAllLedgerMap] = useState<Record<string, boolean>>({});
  const [userCreditDetailsMap, setUserCreditDetailsMap] = useState<
    Record<string, CreditUserDetail>
  >({});

  const toggleMobileUserExpand = async (userId: string) => {
    const willExpand = expandedUserId !== userId;
    if (!willExpand) {
      closeAccordion();
      return;
    }
    setAccordionParams({ expanded: userId, expandedSubtab: null });
    try {
      const params = new URLSearchParams({ days, source });
      const data = await apiFetch<CreditUserDetail>(
        `/admin/credit-analysis/users/${userId}?${params}`,
      );
      setUserCreditDetailsMap((prev) => ({ ...prev, [userId]: data }));
    } catch {
      // Ignore background fetch failure
    }
  };

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
      const data = await apiFetch<{
        items: CreditUserRow[];
        total: number;
        summary?: CreditSummary;
      }>(`/admin/credit-analysis/users?${params}`);
      setRows(data.items);
      setTotal(data.total);

      if (data.summary) {
        setSummary(data.summary);
      } else {
        const fallbackSpent = data.items.reduce((acc, r) => acc + r.totalSpent, 0);
        const fallbackJobs = data.items.reduce((acc, r) => acc + r.totalJobs, 0);
        setSummary({
          totalSpent: fallbackSpent,
          totalJobs: fallbackJobs,
          avgCostPerJob:
            fallbackJobs > 0 ? Math.round((fallbackSpent / fallbackJobs) * 100) / 100 : 0,
          totalUsers: data.total,
        });
      }
    } catch (err) {
      toastRef.current({
        kind: 'error',
        title: 'Failed to load credit analysis',
        body: apiErrorMessage(err, 'Please try again.'),
      });
    } finally {
      setLoading(false);
    }
  }, [page, query, days, source]);

  useEffect(() => {
    load();
  }, [load]);

  const openDetail = (id: string) => {
    setDetailId(id);
  };

  useEffect(() => {
    if (!detailId) {
      loadedDetailIdRef.current = null;
      setDetail(null);
      setDetailLoading(false);
      return;
    }
    let cancelled = false;
    if (loadedDetailIdRef.current !== detailId) {
      setDetailLoading(true);
    }

    (async () => {
      try {
        const params = new URLSearchParams({ days, source });
        const data = await apiFetch<CreditUserDetail>(
          `/admin/credit-analysis/users/${detailId}?${params}`,
        );
        if (!cancelled) {
          loadedDetailIdRef.current = data.id;
          setDetail(data);
          setDetailLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          toastRef.current({
            kind: 'error',
            title: 'Failed to load user detail',
            body: apiErrorMessage(err, 'Please try again.'),
          });
          setDetailLoading(false);
          closeDetailRef.current();
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [detailId, days, source]);

  const handleSearch = (q: string) => {
    setQuery(q);
    setPage(0);
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  useCrumb(
    0,
    detailId
      ? {
          label: detail?.displayName ?? detail?.email ?? 'User details',
          href: `/credit-analysis?user=${encodeURIComponent(detailId)}`,
        }
      : null,
  );

  return (
    <>
      {/* Page Header & Operational Summary Block */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="page-head">
          <div>
            <h1>Credit Analysis</h1>
            <p className="lede">Monitor credit usage, spending and account balances</p>
          </div>
        </div>

        {/* Summary strip - Quick operational insights */}
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 32,
            flexWrap: 'wrap',
          }}
        >
          {[
            {
              label: 'Credits spent',
              value: summary ? summary.totalSpent.toLocaleString() : '—',
              color: 'var(--ink)',
            },
            {
              label: 'Jobs completed',
              value: summary ? summary.totalJobs.toLocaleString() : '—',
              color: 'var(--ink)',
            },
            {
              label: 'Avg. credits / job',
              value: summary ? summary.avgCostPerJob : '—',
              color: 'var(--ink)',
            },
            {
              label: 'Active users',
              value: summary ? summary.totalUsers.toLocaleString() : total.toLocaleString(),
              color: 'var(--ink)',
            },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span
                style={{
                  fontSize: '1.25rem',
                  fontWeight: 700,
                  color,
                  fontFamily: 'var(--mono, monospace)',
                  letterSpacing: '-0.02em',
                }}
              >
                {value}
              </span>
              <span style={{ fontSize: '0.82rem', color: 'var(--muted)', fontWeight: 450 }}>
                {label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Unified Filter Row */}
      <div className="desktop-only">
        <div
          className="filter-row"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'nowrap',
          }}
        >
          {/* Search Input */}
          <div
            className="filter-search-box"
            style={{ width: 280, maxWidth: 320, minWidth: 160, flex: '1 1 200px' }}
          >
            <Icon.Search />
            <input
              placeholder="Search by name or email…"
              value={query}
              onChange={(e) => handleSearch(e.target.value)}
            />
            {query && (
              <button
                className="filter-clear-btn"
                onClick={() => handleSearch('')}
                type="button"
                title="Clear search"
              >
                <Icon.Close />
              </button>
            )}
          </div>

          {/* Segmented Day Range Buttons */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              height: 36,
              boxSizing: 'border-box',
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r)',
              padding: 2,
              gap: 2,
              flexShrink: 0,
            }}
          >
            {(['7', '30', '90', 'all'] as DayRange[]).map((d) => {
              const active = days === d;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => {
                    setDays(d);
                    setPage(0);
                  }}
                  style={{
                    height: '100%',
                    padding: '0 12px',
                    fontSize: '0.82rem',
                    fontWeight: active ? 600 : 450,
                    borderRadius: 'calc(var(--r) - 2px)',
                    border: 'none',
                    cursor: 'pointer',
                    background: active ? 'var(--surface)' : 'transparent',
                    color: active ? 'var(--ink)' : 'var(--muted)',
                    boxShadow: active ? '0 1px 2px rgba(0,0,0,0.2)' : 'none',
                    transition: 'all 0.15s ease',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {d === 'all' ? 'All time' : `${d}d`}
                </button>
              );
            })}
          </div>

          {/* Source Dropdown Filter */}
          <select
            className="filter-select"
            style={{ height: 36, borderRadius: 'var(--r)', flexShrink: 0 }}
            value={source}
            onChange={(e) => {
              setSource(e.target.value as SourceFilter);
              setPage(0);
            }}
          >
            {(Object.keys(SOURCE_LABELS) as SourceFilter[]).map((s) => (
              <option key={s} value={s}>
                {s === 'all' ? 'Source · All' : `Source · ${SOURCE_LABELS[s]}`}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Mobile Navigation Accordion Bar */}
      <div className="mobile-only" style={{ marginBottom: 16 }}>
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            onClick={() => setIsNavOpen((v) => !v)}
            style={{
              width: '100%',
              padding: '12px 16px',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              cursor: 'pointer',
              color: 'var(--ink)',
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon.Search />
              <span>Search &amp; Filters</span>
            </div>
            <span
              style={{
                transform: isNavOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.2s',
                display: 'inline-flex',
              }}
            >
              <Icon.Chevron />
            </span>
          </button>

          {isNavOpen && (
            <>
              <div
                onClick={() => setIsNavOpen(false)}
                style={{ position: 'fixed', inset: 0, zIndex: 99, background: 'transparent' }}
              />
              <div
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 6px)',
                  left: 0,
                  right: 0,
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  boxShadow: 'var(--shadow-lg)',
                  zIndex: 100,
                  padding: '14px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                  maxHeight: '420px',
                  overflowY: 'auto',
                }}
              >
                {/* Search Input */}
                <div className="search" style={{ width: '100%' }}>
                  <Icon.Search />
                  <input
                    placeholder="Search by name or email…"
                    value={query}
                    onChange={(e) => handleSearch(e.target.value)}
                  />
                </div>

                {/* Time Range Filter */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span className="sub" style={{ fontSize: 12, color: 'var(--muted)' }}>
                    Time Range:
                  </span>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                    {(['7', '30', '90', 'all'] as DayRange[]).map((d) => (
                      <button
                        key={d}
                        type="button"
                        className={`btn sm ${days === d ? 'primary' : 'ghost'}`}
                        onClick={() => {
                          setDays(d);
                          setPage(0);
                        }}
                        style={{ justifyContent: 'center', fontSize: 12 }}
                      >
                        {d === 'all' ? 'All' : `${d}d`}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Source Filter Dropdown */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span className="sub" style={{ fontSize: 12, color: 'var(--muted)' }}>
                    Source Filter:
                  </span>
                  <select
                    className="filter-select"
                    style={{ width: '100%' }}
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
              </div>
            </>
          )}
        </div>
      </div>

      {loading ? (
        <p style={{ color: 'var(--muted)', fontSize: 13, padding: '24px 0' }}>
          Loading credit analysis…
        </p>
      ) : (
        <>
          {/* Main Desktop Table */}
          <div className="desktop-only table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>User</th>
                  <th style={{ textAlign: 'right' }}>Credits spent</th>
                  <th style={{ textAlign: 'right' }}>Jobs</th>
                  <th style={{ textAlign: 'right' }}>Avg. credits/job</th>
                  <th style={{ textAlign: 'right' }}>Last activity</th>
                  <th style={{ textAlign: 'right' }}>Credit balance</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const isSelected = detailId === r.id;
                  return (
                    <tr
                      key={r.id}
                      onClick={() => openDetail(r.id)}
                      style={{
                        cursor: 'pointer',
                        background: isSelected
                          ? 'var(--surface-hover, var(--surface-2))'
                          : undefined,
                      }}
                    >
                      <td style={{ textAlign: 'left', maxWidth: 280 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                          <span
                            style={{
                              fontWeight: 600,
                              fontSize: '0.875rem',
                              color: 'var(--ink)',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                            title={r.displayName ?? r.email}
                          >
                            {r.displayName ?? r.email}
                          </span>
                          {r.hasShopifyStore && (
                            <span
                              className="badge dot"
                              style={{
                                background: 'rgba(76,175,80,0.12)',
                                color: 'var(--success, #4caf50)',
                                fontSize: 10,
                                flexShrink: 0,
                              }}
                            >
                              Shopify
                            </span>
                          )}
                        </div>
                        {r.displayName && (
                          <div
                            style={{
                              fontSize: '0.78rem',
                              color: 'var(--muted)',
                              marginTop: 2,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                            title={r.email}
                          >
                            {r.email}
                          </div>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <span className="mono" style={{ fontWeight: 600, color: 'var(--ink)' }}>
                          {r.totalSpent.toLocaleString()}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <span className="mono">{r.totalJobs.toLocaleString()}</span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <span className="mono">{r.avgCostPerJob}</span>
                      </td>
                      <td
                        style={{ textAlign: 'right', color: 'var(--muted)', fontSize: '0.82rem' }}
                      >
                        {r.lastActivityAt ? new Date(r.lastActivityAt).toLocaleDateString() : '—'}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <span className="mono" style={{ fontWeight: 600, color: 'var(--ink)' }}>
                          {r.balance.toLocaleString()}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      style={{
                        padding: 32,
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

          {/* Mobile Cards */}
          <div className="mobile-only">
            {rows.map((r) => {
              const isExpanded = expandedUserId === r.id;
              const userDetail = userCreditDetailsMap[r.id];
              const showAllLedger = showAllLedgerMap[r.id] ?? false;

              return (
                <div
                  key={r.id}
                  className="card"
                  style={{
                    padding: 0,
                    overflow: 'hidden',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    background: 'var(--surface)',
                    marginBottom: 8,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => void toggleMobileUserExpand(r.id)}
                    style={{
                      padding: '14px 16px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      cursor: 'pointer',
                      userSelect: 'none',
                      background: 'none',
                      border: 'none',
                      width: '100%',
                      textAlign: 'left',
                      color: 'inherit',
                      fontFamily: 'inherit',
                      fontSize: 'inherit',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        minWidth: 0,
                        flex: 1,
                      }}
                    >
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div
                          className="semi"
                          style={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            fontSize: 15,
                            color: 'var(--ink)',
                            fontWeight: 600,
                          }}
                        >
                          {r.displayName ?? r.email}
                        </div>
                        {r.displayName && (
                          <div
                            className="sub"
                            style={{ fontSize: 11, marginTop: 2, color: 'var(--muted)' }}
                          >
                            {r.email}
                          </div>
                        )}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 8 }}>
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
                      <span
                        style={{
                          color: 'var(--muted-2)',
                          transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                          transition: 'transform 0.2s',
                          display: 'inline-flex',
                        }}
                      >
                        <Icon.Chevron />
                      </span>
                    </div>
                  </button>

                  {isExpanded && (
                    <div
                      style={{
                        padding: '16px',
                        borderTop: '1px solid var(--border)',
                        background: 'var(--surface-2)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 14,
                        fontSize: 13,
                      }}
                    >
                      {/* Credit Summary Details */}
                      <div
                        style={{
                          background: 'var(--surface)',
                          padding: '12px',
                          borderRadius: 8,
                          border: '1px solid var(--border)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 8,
                        }}
                      >
                        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink)' }}>
                          Credit Summary
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                          }}
                        >
                          <span style={{ color: 'var(--muted)' }}>Plan</span>
                          <span className="badge" style={{ textTransform: 'capitalize' }}>
                            {r.tier}
                          </span>
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                          }}
                        >
                          <span style={{ color: 'var(--muted)' }}>Credits spent</span>
                          <span className="mono bold">{r.totalSpent.toLocaleString()} credits</span>
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                          }}
                        >
                          <span style={{ color: 'var(--muted)' }}>Jobs</span>
                          <span className="mono">{r.totalJobs.toLocaleString()}</span>
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                          }}
                        >
                          <span style={{ color: 'var(--muted)' }}>Avg. credits/job</span>
                          <span className="mono">{r.avgCostPerJob} credits</span>
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                          }}
                        >
                          <span style={{ color: 'var(--muted)' }}>Last Activity</span>
                          <span className="sub">
                            {r.lastActivityAt
                              ? new Date(r.lastActivityAt).toLocaleDateString()
                              : 'No activity'}
                          </span>
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                          }}
                        >
                          <span style={{ color: 'var(--muted)' }}>Credit balance</span>
                          <span className="mono bold" style={{ color: 'var(--ink)', fontSize: 14 }}>
                            {r.balance.toLocaleString()} credits
                          </span>
                        </div>
                      </div>

                      {/* Sub-tabs for Daily Spent & Recent Ledger */}
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          className={`btn sm ${activeSubTab === 'graph' ? 'primary' : 'ghost'}`}
                          onClick={() =>
                            setAccordionParams({
                              expanded: r.id,
                              expandedSubtab: activeSubTab === 'graph' ? null : 'graph',
                            })
                          }
                          style={{ flex: 1, justifyContent: 'center' }}
                        >
                          Daily Spent Graph
                        </button>
                        <button
                          className={`btn sm ${activeSubTab === 'ledger' ? 'primary' : 'ghost'}`}
                          onClick={() =>
                            setAccordionParams({
                              expanded: r.id,
                              expandedSubtab: activeSubTab === 'ledger' ? null : 'ledger',
                            })
                          }
                          style={{ flex: 1, justifyContent: 'center' }}
                        >
                          Recent Ledger
                        </button>
                      </div>

                      {/* Daily Spent Section */}
                      {activeSubTab === 'graph' && (
                        <div
                          style={{
                            background: 'var(--surface)',
                            padding: '12px',
                            borderRadius: 8,
                            border: '1px solid var(--border)',
                          }}
                        >
                          <div
                            style={{
                              fontSize: 12,
                              fontWeight: 700,
                              color: 'var(--ink)',
                              marginBottom: 10,
                            }}
                          >
                            Daily Credit Spend Chart
                          </div>
                          {userDetail?.dailySpend && userDetail.dailySpend.length > 0 ? (
                            <ResponsiveContainer width="100%" height={180} debounce={50}>
                              <BarChart data={userDetail.dailySpend}>
                                <XAxis
                                  dataKey="date"
                                  stroke="var(--muted)"
                                  fontSize={10}
                                  tickLine={false}
                                  axisLine={false}
                                />
                                <Tooltip
                                  cursor={{ fill: 'rgba(128,128,128,0.08)' }}
                                  contentStyle={{
                                    background: 'var(--surface-2)',
                                    border: '1px solid var(--border)',
                                    borderRadius: 8,
                                    fontSize: 11,
                                  }}
                                />
                                <Bar dataKey="spent" fill="var(--accent)" radius={[4, 4, 0, 0]} />
                              </BarChart>
                            </ResponsiveContainer>
                          ) : (
                            <span className="sub" style={{ fontSize: 12, color: 'var(--muted)' }}>
                              Loading daily spend graph&hellip;
                            </span>
                          )}
                        </div>
                      )}

                      {/* Recent Ledger Entries Section */}
                      {activeSubTab === 'ledger' && (
                        <div
                          style={{
                            background: 'var(--surface)',
                            padding: '12px',
                            borderRadius: 8,
                            border: '1px solid var(--border)',
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              marginBottom: 10,
                            }}
                          >
                            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink)' }}>
                              Recent Ledger Entries
                            </span>
                            <span className="badge dot" style={{ fontSize: 10 }}>
                              {SOURCE_LABELS[source]}
                            </span>
                          </div>
                          {(() => {
                            const activeLedger = userDetail?.ledger
                              ? source === 'all'
                                ? userDetail.ledger
                                : userDetail.ledger.filter((l) => l.source === source)
                              : [];

                            if (!activeLedger.length) {
                              return (
                                <span
                                  className="sub"
                                  style={{ fontSize: 12, color: 'var(--muted)' }}
                                >
                                  {userDetail
                                    ? `No ledger entries found for ${SOURCE_LABELS[source]}.`
                                    : 'Loading ledger data…'}
                                </span>
                              );
                            }

                            return (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                {(showAllLedger ? activeLedger : activeLedger.slice(0, 3)).map(
                                  (l) => (
                                    <div
                                      key={l.id}
                                      style={{
                                        padding: '8px 10px',
                                        borderRadius: 6,
                                        background: 'var(--surface-2)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        fontSize: 12,
                                      }}
                                    >
                                      <div
                                        style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                                      >
                                        <span
                                          className="mono bold"
                                          style={{
                                            color:
                                              l.delta < 0
                                                ? 'var(--danger)'
                                                : 'var(--success, #4caf50)',
                                          }}
                                        >
                                          {l.delta > 0 ? '+' : ''}
                                          {l.delta}
                                        </span>
                                        <span style={{ color: 'var(--ink)', fontSize: 11 }}>
                                          {l.reason}
                                        </span>
                                      </div>
                                      <span style={{ fontSize: 10, color: 'var(--muted)' }}>
                                        {new Date(l.createdAt).toLocaleDateString()}
                                      </span>
                                    </div>
                                  ),
                                )}
                                {activeLedger.length > 3 && (
                                  <button
                                    className="btn sm ghost"
                                    onClick={() =>
                                      setShowAllLedgerMap((prev) => ({
                                        ...prev,
                                        [r.id]: !prev[r.id],
                                      }))
                                    }
                                    style={{ width: '100%', marginTop: 4 }}
                                  >
                                    {showAllLedger
                                      ? 'Show less'
                                      : `Show more (${activeLedger.length - 3} more)`}
                                  </button>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {rows.length === 0 && (
              <div
                style={{
                  textAlign: 'center',
                  color: 'var(--muted)',
                  padding: '2.5rem',
                  border: '1.5px dashed var(--border)',
                  borderRadius: 8,
                }}
              >
                No users found.
              </div>
            )}
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

      {/* User Details Right-Side Drawer */}
      {detailId && (
        <div className="modal-overlay" onClick={closeDetail}>
          <div
            className="drawer"
            onClick={(e) => e.stopPropagation()}
            style={{ width: '520px', maxWidth: '100vw' }}
          >
            <div className="drawer-head">
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <h2
                    style={{
                      margin: 0,
                      fontSize: '1.15rem',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      maxWidth: 340,
                    }}
                    title={detail?.displayName ?? detail?.email ?? 'User details'}
                  >
                    {detail?.displayName ?? detail?.email ?? 'User details'}
                  </h2>
                  {detail?.tier && (
                    <span
                      style={{
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        color: 'var(--muted)',
                        background: 'var(--surface-2)',
                        border: '1px solid var(--border)',
                        borderRadius: 4,
                        padding: '2px 8px',
                        textTransform: 'capitalize',
                      }}
                    >
                      {detail.tier}
                    </span>
                  )}
                  {detail?.hasShopifyStore && (
                    <span
                      style={{
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        color: 'var(--success, #4caf50)',
                        background: 'rgba(76,175,80,0.12)',
                        border: '1px solid rgba(76,175,80,0.25)',
                        borderRadius: 4,
                        padding: '2px 8px',
                      }}
                    >
                      Shopify
                    </span>
                  )}
                </div>
                {detail?.displayName && (
                  <div style={{ color: 'var(--muted)', fontSize: '0.8rem', marginTop: 3 }}>
                    {detail.email}
                  </div>
                )}
              </div>
              <button
                type="button"
                className="btn sm ghost"
                onClick={closeDetail}
                style={{ marginLeft: 'auto' }}
                title="Close"
              >
                <Icon.Close />
              </button>
            </div>

            <div
              className="drawer-body"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 16,
                padding: '20px',
              }}
            >
              {detailLoading || !detail ? (
                <p style={{ color: 'var(--muted)', padding: '24px 0', fontSize: '0.875rem' }}>
                  Loading user details…
                </p>
              ) : (
                <>
                  {/* 2x2 Metric Grid */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(2, 1fr)',
                      gap: 10,
                    }}
                  >
                    <div
                      style={{
                        background: 'var(--surface-2)',
                        border: '1px solid var(--border)',
                        borderRadius: 8,
                        padding: '12px 14px',
                      }}
                    >
                      <div style={{ fontSize: '0.75rem', color: 'var(--muted)', fontWeight: 500 }}>
                        Credit balance
                      </div>
                      <div
                        style={{
                          fontSize: '1.25rem',
                          fontWeight: 700,
                          color: 'var(--ink)',
                          marginTop: 4,
                          fontFamily: 'var(--mono, monospace)',
                        }}
                      >
                        {detail.balance.toLocaleString()}
                      </div>
                    </div>

                    <div
                      style={{
                        background: 'var(--surface-2)',
                        border: '1px solid var(--border)',
                        borderRadius: 8,
                        padding: '12px 14px',
                      }}
                    >
                      <div style={{ fontSize: '0.75rem', color: 'var(--muted)', fontWeight: 500 }}>
                        {days === 'all' ? 'All-time credits spent' : `${days}d credits spent`}
                      </div>
                      <div
                        style={{
                          fontSize: '1.25rem',
                          fontWeight: 700,
                          color: 'var(--ink)',
                          marginTop: 4,
                          fontFamily: 'var(--mono, monospace)',
                        }}
                      >
                        {detail.dailySpend.reduce((acc, d) => acc + d.spent, 0).toLocaleString()}
                      </div>
                    </div>

                    <div
                      style={{
                        background: 'var(--surface-2)',
                        border: '1px solid var(--border)',
                        borderRadius: 8,
                        padding: '12px 14px',
                      }}
                    >
                      <div style={{ fontSize: '0.75rem', color: 'var(--muted)', fontWeight: 500 }}>
                        Total jobs
                      </div>
                      <div
                        style={{
                          fontSize: '1.25rem',
                          fontWeight: 700,
                          color: 'var(--ink)',
                          marginTop: 4,
                          fontFamily: 'var(--mono, monospace)',
                        }}
                      >
                        {rows.find((r) => r.id === detail.id)?.totalJobs.toLocaleString() ??
                          detail.ledger.filter((l) => l.delta < 0 && l.jobId).length}
                      </div>
                    </div>

                    <div
                      style={{
                        background: 'var(--surface-2)',
                        border: '1px solid var(--border)',
                        borderRadius: 8,
                        padding: '12px 14px',
                      }}
                    >
                      <div style={{ fontSize: '0.75rem', color: 'var(--muted)', fontWeight: 500 }}>
                        Avg. credits / job
                      </div>
                      <div
                        style={{
                          fontSize: '1.25rem',
                          fontWeight: 700,
                          color: 'var(--ink)',
                          marginTop: 4,
                          fontFamily: 'var(--mono, monospace)',
                        }}
                      >
                        {rows.find((r) => r.id === detail.id)?.avgCostPerJob ?? 0}
                      </div>
                    </div>
                  </div>

                  {/* Daily Spend Graph Card */}
                  <div
                    style={{
                      background: 'var(--surface-2)',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      padding: '14px',
                    }}
                  >
                    <div
                      style={{
                        fontSize: '0.85rem',
                        fontWeight: 600,
                        color: 'var(--ink)',
                        marginBottom: 10,
                      }}
                    >
                      Daily credit spend · {days === 'all' ? 'All time' : `Last ${days} days`}
                    </div>
                    {detail.dailySpend.length > 0 ? (
                      <ResponsiveContainer width="100%" height={160} debounce={50}>
                        <BarChart data={detail.dailySpend}>
                          <XAxis
                            dataKey="date"
                            stroke="var(--muted)"
                            fontSize={10}
                            tickLine={false}
                            axisLine={false}
                          />
                          <Tooltip
                            cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                            wrapperStyle={{ zIndex: 100 }}
                            content={({ active, payload, label }) => {
                              if (!active || !payload?.length) return null;
                              const spent = Number(payload[0].value ?? 0);
                              const dateStr = label
                                ? new Date(`${label}T00:00:00`).toLocaleDateString('en-US', {
                                    month: 'short',
                                    day: 'numeric',
                                    year: 'numeric',
                                  })
                                : '';
                              return (
                                <div
                                  style={{
                                    background: 'var(--surface)',
                                    border: '1px solid var(--border)',
                                    borderRadius: 6,
                                    padding: '8px 12px',
                                    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                                  }}
                                >
                                  <div
                                    style={{
                                      fontSize: '0.75rem',
                                      color: 'var(--muted)',
                                      fontWeight: 500,
                                    }}
                                  >
                                    {dateStr}
                                  </div>
                                  <div
                                    style={{
                                      fontSize: '0.85rem',
                                      color: 'var(--ink)',
                                      fontWeight: 600,
                                      marginTop: 3,
                                    }}
                                  >
                                    Credits spent:{' '}
                                    <span style={{ fontFamily: 'var(--mono, monospace)' }}>
                                      {spent.toLocaleString()}
                                    </span>
                                  </div>
                                </div>
                              );
                            }}
                          />
                          <Bar dataKey="spent" fill="var(--accent)" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <p style={{ color: 'var(--muted)', fontSize: '0.8rem', margin: 0 }}>
                        No daily spend activity in this period.
                      </p>
                    )}
                  </div>

                  {/* Top Products (Shopify) */}
                  {detail.hasShopifyStore && (
                    <div
                      style={{
                        background: 'var(--surface-2)',
                        border: '1px solid var(--border)',
                        borderRadius: 8,
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          padding: '12px 14px',
                          borderBottom: '1px solid var(--border)',
                          fontSize: '0.85rem',
                          fontWeight: 600,
                          color: 'var(--ink)',
                        }}
                      >
                        Top products
                      </div>
                      {detail.topProducts.length ? (
                        <div className="table-wrap">
                          <table className="table" style={{ fontSize: '0.8rem' }}>
                            <thead>
                              <tr>
                                <th>Product</th>
                                <th style={{ textAlign: 'right' }}>Try-ons</th>
                                <th style={{ textAlign: 'right' }}>Credits</th>
                              </tr>
                            </thead>
                            <tbody>
                              {detail.topProducts.map((p) => (
                                <tr key={p.shopifyProductId}>
                                  <td>{p.title ?? `Product #${p.shopifyProductId}`}</td>
                                  <td style={{ textAlign: 'right' }} className="mono">
                                    {p.jobCount}
                                  </td>
                                  <td style={{ textAlign: 'right' }} className="mono">
                                    {p.creditsSpent}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div style={{ padding: '14px', color: 'var(--muted)', fontSize: '0.8rem' }}>
                          No product try-ons in this window.
                        </div>
                      )}
                    </div>
                  )}

                  {/* Credit Activity / Ledger */}
                  <div
                    style={{
                      background: 'var(--surface-2)',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      overflow: 'hidden',
                      display: 'flex',
                      flexDirection: 'column',
                      flex: 1,
                      minHeight: 280,
                    }}
                  >
                    <div
                      style={{
                        padding: '12px 14px',
                        borderBottom: '1px solid var(--border)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--ink)' }}>
                        Credit activity
                      </div>
                      <select
                        className="filter-select"
                        style={{ fontSize: '0.78rem', padding: '3px 8px', height: 'auto' }}
                        value={source}
                        onChange={(e) => setSource(e.target.value as SourceFilter)}
                      >
                        {(Object.keys(SOURCE_LABELS) as SourceFilter[]).map((s) => (
                          <option key={s} value={s}>
                            {SOURCE_LABELS[s]}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div style={{ flex: 1, overflowY: 'auto', minHeight: 200, maxHeight: 480 }}>
                      {detail.ledger.length ? (
                        detail.ledger.map((l) => {
                          const act = formatActivity(l);
                          return (
                            <div
                              key={l.id}
                              style={{
                                padding: '11px 14px',
                                borderBottom: '1px solid var(--border)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: 12,
                              }}
                            >
                              <div style={{ minWidth: 0, flex: 1 }}>
                                <div
                                  style={{
                                    color: 'var(--ink)',
                                    fontSize: '0.82rem',
                                    fontWeight: 500,
                                  }}
                                >
                                  {act.title}
                                </div>
                                <div
                                  style={{
                                    color: 'var(--muted)',
                                    fontSize: '0.72rem',
                                    marginTop: 2,
                                  }}
                                >
                                  {act.subtitle} ·{' '}
                                  {new Date(l.createdAt).toLocaleTimeString([], {
                                    hour: 'numeric',
                                    minute: '2-digit',
                                  })}{' '}
                                  ·{' '}
                                  {new Date(l.createdAt).toLocaleDateString([], {
                                    month: 'short',
                                    day: 'numeric',
                                  })}
                                </div>
                              </div>
                              <div
                                style={{
                                  fontWeight: 700,
                                  fontFamily: 'var(--mono, monospace)',
                                  fontSize: '0.82rem',
                                  color: l.delta < 0 ? 'var(--danger)' : 'var(--success, #4caf50)',
                                  textAlign: 'right',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {l.delta > 0
                                  ? `+${l.delta.toLocaleString()}`
                                  : l.delta.toLocaleString()}{' '}
                                credits
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <div
                          style={{
                            padding: '24px 14px',
                            color: 'var(--muted)',
                            fontSize: '0.8rem',
                            textAlign: 'center',
                          }}
                        >
                          No credit activity in this window.
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>

            <div
              className="drawer-foot"
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <button type="button" className="btn ghost" onClick={closeDetail}>
                Close
              </button>
              {detail && (
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => {
                    navigate(`/users?user=${encodeURIComponent(detail.id)}`, {
                      state: { search: detail.email },
                    });
                  }}
                >
                  View user profile →
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
