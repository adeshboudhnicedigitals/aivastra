import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Icon } from '../components/Icons';
import { StatusBadge } from '../components/StatusBadge';
import { useAuth } from '../context/AuthContext';
import { useCrumb } from '../context/BreadcrumbContext';
import { useCloseOverlay } from '../hooks/use-close-overlay';
import { useUrlState } from '../hooks/use-url-state';
import { apiErrorMessage, apiFetch } from '../lib/data';

interface ShopifyStore {
  id: string;
  shopDomain: string;
  shopEmail: string | null;
  // Business identity Shopify hands over at install (SHOP_DETAILS query) —
  // null for any store installed before this was persisted, until it reinstalls.
  shopName: string | null;
  shopOwnerName: string | null;
  shopPhone: string | null;
  shopAddress: string | null;
  ianaTimezone: string | null;
  partnerDevelopment: boolean;
  scope: string;
  balance: number;
  installedAt: string;
  uninstalledAt: string | null;
  jobsCount: number;
  failedJobsCount: number;
}

interface LedgerEntry {
  id: string;
  reason: string;
  delta: number;
  createdAt: string;
  jobId: string | null;
}

interface StoreJob {
  id: string;
  status: string;
  creditsCharged: number;
  workerId: string | null;
  errorCode: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  shopperEmail: string | null;
}

type GrowthDayRange = '7' | '30' | '90' | 'all';

interface GrowthPoint {
  date: string;
  installs: number;
  uninstalls: number;
  activeMerchants: number;
}

interface GrowthData {
  days: GrowthDayRange;
  series: GrowthPoint[];
  installsTotal: number;
  uninstallsTotal: number;
  startActive: number;
  endActive: number;
  growthPct: number | null;
}

interface Props {
  toast: (opts: { kind?: 'error'; title: string; body?: string }) => void;
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

/** "3d ago" / "2mo ago" / "just now" — coarse, human-scale relative time for a badge. */
function relativeTime(value: string | null): string | null {
  if (!value) return null;
  const diffSec = Math.round((Date.now() - new Date(value).getTime()) / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  const diffMonth = Math.round(diffDay / 30);
  if (diffMonth < 12) return `${diffMonth}mo ago`;
  const diffYear = Math.round(diffMonth / 12);
  return `${diffYear}y ago`;
}

/** 'YYYY-MM-DD' -> 'Sep 8', for chart axis ticks. */
function shortChartDate(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function signedDelta(delta: number): string {
  return `${delta > 0 ? '+' : ''}${delta.toLocaleString()}`;
}

/** Mirrors JobsPage's fmtDuration exactly, for the same column on this store-scoped table. */
function fmtJobDuration(job: StoreJob): string | null {
  if (!job.startedAt || !job.completedAt) return null;
  const ms = new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime();
  return `${(ms / 1000).toFixed(1)}s`;
}

// Every internal company test install uses a shop email containing this —
// e.g. chaitanya.nicedigitals@gmail.com. Not a Shopify-provided flag, just
// the naming convention the team already follows for test stores.
const COMPANY_EMAIL_MARKER = 'nicedigitals';
function isCompanyStore(store: ShopifyStore): boolean {
  return (store.shopEmail ?? '').toLowerCase().includes(COMPANY_EMAIL_MARKER);
}

/** Opens the live storefront in a new tab without triggering a parent row's onClick. */
function StoreLink({ domain, label }: { domain: string; label?: string }) {
  return (
    <a
      href={`https://${domain}`}
      target="_blank"
      rel="noreferrer"
      className="link"
      onClick={(e) => e.stopPropagation()}
      title={`Open ${domain} in a new tab`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
    >
      {label ?? domain} <Icon.ExternalLink />
    </a>
  );
}

/** "Joined 10d ago" / "Uninstalled 3d ago" badge, with the exact timestamp underneath. */
function DateBadge({
  value,
  kind,
  align = 'flex-start',
}: {
  value: string | null;
  kind: 'installed' | 'uninstalled';
  align?: 'flex-start' | 'flex-end';
}) {
  const rel = relativeTime(value);
  if (!value || !rel) return <span style={{ color: 'var(--muted)' }}>—</span>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: align }}>
      <span
        className={kind === 'uninstalled' ? 'badge danger' : 'badge success'}
        style={{ width: 'fit-content' }}
      >
        {kind === 'uninstalled' ? 'Uninstalled' : 'Joined'} {rel}
      </span>
      <span className="sub" style={{ fontSize: 11 }}>
        {formatDate(value)}
      </span>
    </div>
  );
}

/** Shopify's shop.plan.partnerDevelopment — a dev store, so its charges are test-mode only. */
function TestStoreBadge() {
  return (
    <span
      className="badge warn"
      style={{ fontSize: 10 }}
      title="Partner development store — billing is test-mode only"
    >
      Test store
    </span>
  );
}

/** Shop name (falls back to domain) as the primary label, with the actual
 *  *.myshopify.com domain always present as a clickable line — a secondary
 *  line when a name is known, or the clickable primary line itself when it
 *  isn't (stores installed before shop_name was persisted). A Test store
 *  badge appears when Shopify reports this as a partner development store. */
function StoreIdentity({ store }: { store: ShopifyStore }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {store.shopName ? (
          <span style={{ fontWeight: 600 }}>{store.shopName}</span>
        ) : (
          <span style={{ fontWeight: 600 }}>
            <StoreLink domain={store.shopDomain} />
          </span>
        )}
        {store.partnerDevelopment && <TestStoreBadge />}
      </div>
      {store.shopName && <StoreLink domain={store.shopDomain} label={store.shopDomain} />}
    </div>
  );
}

export default function ShopifyStoresPage({ toast }: Props) {
  const navigate = useNavigate();
  const { role: myRole } = useAuth();
  const isSuperAdmin = myRole === 'SUPER_ADMIN';
  const [stores, setStores] = useState<ShopifyStore[]>([]);
  const [loading, setLoading] = useState(true);
  // Internal company testers install real Shopify stores under emails
  // containing "nicedigitals" (see COMPANY_EMAIL_MARKER) — the only reliable
  // signal we have to tell those apart from genuine merchant installs, since
  // there's no separate "test store" flag for this. Client-side, not a server
  // filter: this list is already fetched in full (no pagination on this route).
  const [storeSegment, setStoreSegment] = useState<'all' | 'company' | 'customers'>('all');
  // No GET-by-id endpoint exists for a single store, so the detail view is
  // resolved against the already-loaded `stores` list (same approach as the
  // GarmentTypesTab pilot), not a fresh fetch like Jobs/Users' `job=`/`user=`.
  const [storeIdParam, setStoreIdParam] = useUrlState('store');
  const closeDetail = useCloseOverlay(['store']);
  const selectedStore = useMemo(
    () => stores.find((s) => s.id === storeIdParam) ?? null,
    [stores, storeIdParam],
  );
  const companyCount = useMemo(() => stores.filter(isCompanyStore).length, [stores]);
  const filteredStores = useMemo(() => {
    if (storeSegment === 'company') return stores.filter(isCompanyStore);
    if (storeSegment === 'customers') return stores.filter((s) => !isCompanyStore(s));
    return stores;
  }, [stores, storeSegment]);
  const [expandedStoreId, setExpandedStoreIdParam] = useUrlState('expanded');
  const closeAccordion = useCloseOverlay(['expanded']);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [storeJobs, setStoreJobs] = useState<StoreJob[]>([]);
  const [jobsNextCursor, setJobsNextCursor] = useState<string | null>(null);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobsLoadingMore, setJobsLoadingMore] = useState(false);
  // Delete is only ever reachable from the open store's own detail view, so
  // no confirmId is needed — the target is always `selectedStore`.
  const [confirmParam, setConfirmParam] = useUrlState('confirm');
  const closeConfirm = useCloseOverlay(['confirm']);
  const confirmDelete = confirmParam === 'delete-store' ? selectedStore : null;
  const [deleting, setDeleting] = useState(false);

  useCrumb(
    0,
    selectedStore
      ? {
          label: selectedStore.shopDomain,
          href: `/shopify-stores?store=${encodeURIComponent(selectedStore.id)}`,
        }
      : null,
  );
  useCrumb(
    1,
    confirmDelete
      ? {
          label: 'Delete store',
          href: `/shopify-stores?store=${encodeURIComponent(confirmDelete.id)}&confirm=delete-store`,
        }
      : null,
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ stores: ShopifyStore[] }>('/admin/shopify-stores');
      setStores(data.stores);
    } catch (err) {
      toast({
        kind: 'error',
        title: 'Failed to load Shopify stores',
        body: apiErrorMessage(err, 'Please try again.'),
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const [growthDays, setGrowthDays] = useState<GrowthDayRange>('30');
  const [growth, setGrowth] = useState<GrowthData | null>(null);
  const [growthLoading, setGrowthLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setGrowthLoading(true);
    apiFetch<GrowthData>(`/admin/shopify-stores/growth?days=${growthDays}`)
      .then((data) => {
        if (!cancelled) setGrowth(data);
      })
      .catch((err) => {
        if (!cancelled) {
          toast({
            kind: 'error',
            title: 'Failed to load merchant growth',
            body: apiErrorMessage(err, 'Please try again.'),
          });
        }
      })
      .finally(() => {
        if (!cancelled) setGrowthLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [growthDays, toast]);

  const loadLedger = useCallback(
    async (storeId: string, cursor?: string) => {
      if (cursor) setLoadingMore(true);
      else setLedgerLoading(true);
      try {
        const params = new URLSearchParams({ limit: '50' });
        if (cursor) params.set('cursor', cursor);
        const data = await apiFetch<{ entries: LedgerEntry[]; nextCursor: string | null }>(
          `/admin/shopify-stores/${storeId}/ledger?${params}`,
        );
        setLedger((previous) => (cursor ? [...previous, ...data.entries] : data.entries));
        setNextCursor(data.nextCursor);
      } catch (err) {
        toast({
          kind: 'error',
          title: 'Failed to load store ledger',
          body: apiErrorMessage(err, 'Please try again.'),
        });
      } finally {
        setLedgerLoading(false);
        setLoadingMore(false);
      }
    },
    [toast],
  );

  const loadStoreJobs = useCallback(
    async (storeId: string, cursor?: string) => {
      if (cursor) setJobsLoadingMore(true);
      else setJobsLoading(true);
      try {
        const params = new URLSearchParams({ limit: '20' });
        if (cursor) params.set('cursor', cursor);
        const data = await apiFetch<{ jobs: StoreJob[]; nextCursor: string | null }>(
          `/admin/shopify-stores/${storeId}/jobs?${params}`,
        );
        setStoreJobs((previous) => (cursor ? [...previous, ...data.jobs] : data.jobs));
        setJobsNextCursor(data.nextCursor);
      } catch (err) {
        toast({
          kind: 'error',
          title: 'Failed to load store jobs',
          body: apiErrorMessage(err, 'Please try again.'),
        });
      } finally {
        setJobsLoading(false);
        setJobsLoadingMore(false);
      }
    },
    [toast],
  );

  function openStore(store: ShopifyStore) {
    setStoreIdParam(store.id);
  }

  // Jobs' search filters on jobs.userId/users.email/username/shopifyStores.shopEmail
  // (see JobsQuery in admin/jobs.routes.ts) — shopEmail is the only field that
  // scopes results to this one store, so a store with none can't be deep-linked.
  function goToFailedJobs(store: ShopifyStore) {
    navigate('/jobs', {
      state: { filter: 'FAILED', search: store.shopEmail ?? undefined },
    });
  }

  function goToStoreJobs(store: ShopifyStore) {
    navigate('/jobs', { state: { filter: 'all', search: store.shopEmail ?? undefined } });
  }

  function goToJob(jobId: string) {
    if (!selectedStore) return;
    navigate(
      `/jobs?job=${encodeURIComponent(jobId)}&fromStore=${encodeURIComponent(selectedStore.id)}`,
    );
  }

  // Reconstructs the ledger and the job list from the URL alone — covers a
  // hard refresh, a deep link, and the physical Back button restoring a
  // previous `store=` value, in addition to a plain row click. Resets
  // pagination for both whenever the resolved store id changes.
  useEffect(() => {
    if (!selectedStore) return;
    setLedger([]);
    setNextCursor(null);
    void loadLedger(selectedStore.id);
    setStoreJobs([]);
    setJobsNextCursor(null);
    void loadStoreJobs(selectedStore.id);
  }, [selectedStore?.id, loadLedger, loadStoreJobs]);

  async function handleDeleteConfirm() {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      await apiFetch(`/admin/shopify-stores/${confirmDelete.id}`, { method: 'DELETE' });
      toast({ title: `${confirmDelete.shopDomain} deleted` });
      await load();
      // Clear `store` together with `confirm` in one navigation — the
      // deleted store's id must not survive in the URL, or the ledger
      // reconstruction effect above re-fetches it and 404s right after this
      // success toast (and again on refresh).
      navigate('/shopify-stores', { replace: true });
    } catch (err) {
      toast({
        kind: 'error',
        title: 'Failed to delete store',
        body: apiErrorMessage(err, 'Please try again.'),
      });
    } finally {
      setDeleting(false);
    }
  }

  if (selectedStore) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div className="page-head">
          <div>
            <button className="btn ghost" onClick={closeDetail}>
              <Icon.Back /> Back to Shopify Stores
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
              <h1 style={{ margin: 0 }}>{selectedStore.shopName ?? selectedStore.shopDomain}</h1>
              {selectedStore.partnerDevelopment && <TestStoreBadge />}
            </div>
            {selectedStore.shopName && (
              <div style={{ marginTop: 4 }}>
                <StoreLink domain={selectedStore.shopDomain} />
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <a
              href={`https://${selectedStore.shopDomain}`}
              target="_blank"
              rel="noreferrer"
              className="btn ghost"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <Icon.ExternalLink /> Open store
            </a>
            {isSuperAdmin && (
              <button className="btn danger" onClick={() => setConfirmParam('delete-store')}>
                <Icon.Trash /> Delete store data
              </button>
            )}
          </div>
        </div>

        {/* Desktop Detail View */}
        <div className="desktop-only">
          <div
            className="kv-grid"
            style={{ gridTemplateColumns: 'repeat(5, 1fr)', marginBottom: 20 }}
          >
            <div className="kv">
              <span className="k">Credit balance</span>
              <span className="v">{selectedStore.balance.toLocaleString()}</span>
            </div>
            <div className="kv">
              <span className="k">Jobs generated</span>
              <span className="v">{selectedStore.jobsCount.toLocaleString()}</span>
            </div>
            <div className="kv">
              <span className="k">Failed jobs</span>
              {selectedStore.failedJobsCount > 0 ? (
                <button
                  type="button"
                  className="v"
                  style={{
                    color: 'var(--danger)',
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    textAlign: 'left',
                    cursor: selectedStore.shopEmail ? 'pointer' : 'default',
                  }}
                  disabled={!selectedStore.shopEmail}
                  onClick={() => goToFailedJobs(selectedStore)}
                >
                  {selectedStore.failedJobsCount.toLocaleString()}
                </button>
              ) : (
                <span className="v">0</span>
              )}
            </div>
            <div className="kv">
              <span className="k">Installed</span>
              <DateBadge value={selectedStore.installedAt} kind="installed" />
            </div>
            <div className="kv">
              <span className="k">Uninstalled</span>
              <DateBadge value={selectedStore.uninstalledAt} kind="uninstalled" />
            </div>
          </div>

          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-head">
              <h3>Shop details</h3>
            </div>
            <div className="card-body">
              <div className="kv-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                <div className="kv">
                  <span className="k">Owner</span>
                  <span
                    className="v"
                    style={{ color: selectedStore.shopOwnerName ? undefined : 'var(--muted)' }}
                  >
                    {selectedStore.shopOwnerName ?? '—'}
                  </span>
                </div>
                <div className="kv">
                  <span className="k">Email</span>
                  <span
                    className="v"
                    style={{ color: selectedStore.shopEmail ? undefined : 'var(--muted)' }}
                  >
                    {selectedStore.shopEmail ?? '—'}
                  </span>
                </div>
                <div className="kv">
                  <span className="k">Phone</span>
                  <span
                    className="v"
                    style={{ color: selectedStore.shopPhone ? undefined : 'var(--muted)' }}
                  >
                    {selectedStore.shopPhone ?? '—'}
                  </span>
                </div>
                <div className="kv">
                  <span className="k">Address</span>
                  <span
                    className="v"
                    style={{ color: selectedStore.shopAddress ? undefined : 'var(--muted)' }}
                  >
                    {selectedStore.shopAddress ?? '—'}
                  </span>
                </div>
                <div className="kv">
                  <span className="k">Timezone</span>
                  <span
                    className="v"
                    style={{ color: selectedStore.ianaTimezone ? undefined : 'var(--muted)' }}
                  >
                    {selectedStore.ianaTimezone ?? '—'}
                  </span>
                </div>
                <div className="kv">
                  <span className="k">Permissions granted</span>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {selectedStore.scope.split(',').map((s) => (
                      <span key={s} className="badge mono">
                        {s.trim()}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 20 }}>
            <div
              className="card-head"
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
            >
              <h3>Jobs</h3>
              {selectedStore.shopEmail && (
                <button
                  type="button"
                  className="btn sm ghost"
                  onClick={() => goToStoreJobs(selectedStore)}
                >
                  View in Jobs page &rarr;
                </button>
              )}
            </div>
            <div className="card-body">
              {jobsLoading ? (
                <p style={{ color: 'var(--muted)', fontSize: 13 }}>Loading…</p>
              ) : storeJobs.length === 0 ? (
                <p style={{ color: 'var(--muted)', fontSize: 13 }}>No jobs yet.</p>
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Job ID</th>
                        <th>Status</th>
                        <th style={{ textAlign: 'right' }}>Credits</th>
                        <th>Worker</th>
                        <th>Shopper</th>
                        <th>Created</th>
                        <th>Duration</th>
                      </tr>
                    </thead>
                    <tbody>
                      {storeJobs.map((job) => (
                        <tr
                          key={job.id}
                          onClick={() => goToJob(job.id)}
                          style={{ cursor: 'pointer' }}
                          title={`View job ${job.id} — input, output & events`}
                        >
                          <td>
                            <span
                              style={{
                                fontFamily: 'var(--mono)',
                                fontSize: 12,
                                color: 'var(--accent)',
                                textDecoration: 'underline',
                              }}
                            >
                              {job.id.slice(0, 8)}&hellip;
                            </span>
                          </td>
                          <td>
                            <StatusBadge status={job.status} />
                            {job.status === 'FAILED' && job.errorCode && (
                              <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
                                {job.errorCode}
                              </div>
                            )}
                          </td>
                          <td style={{ textAlign: 'right' }}>{job.creditsCharged}</td>
                          <td>{job.workerId ?? '—'}</td>
                          <td style={{ color: job.shopperEmail ? undefined : 'var(--muted)' }}>
                            {job.shopperEmail ?? '—'}
                          </td>
                          <td>{formatDate(job.createdAt)}</td>
                          <td>{fmtJobDuration(job) ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {jobsNextCursor && (
                <button
                  type="button"
                  className="btn ghost"
                  style={{ marginTop: 16 }}
                  disabled={jobsLoadingMore}
                  onClick={() => void loadStoreJobs(selectedStore.id, jobsNextCursor as string)}
                >
                  {jobsLoadingMore ? 'Loading…' : 'Load more'}
                </button>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h3>Credit activity</h3>
            </div>
            <div className="card-body">
              {ledgerLoading ? (
                <p style={{ color: 'var(--muted)', fontSize: 13 }}>Loading…</p>
              ) : ledger.length === 0 ? (
                <p style={{ color: 'var(--muted)', fontSize: 13 }}>No ledger entries yet.</p>
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Reason</th>
                        <th style={{ textAlign: 'right' }}>Delta</th>
                        <th>Timestamp</th>
                        <th>Job ID</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledger.map((entry) => (
                        <tr key={entry.id}>
                          <td>{entry.reason}</td>
                          <td
                            style={{
                              textAlign: 'right',
                              color: entry.delta < 0 ? 'var(--danger)' : 'var(--success)',
                              fontWeight: 500,
                            }}
                          >
                            {signedDelta(entry.delta)}
                          </td>
                          <td>{formatDate(entry.createdAt)}</td>
                          <td>
                            {entry.jobId ? (
                              <button
                                type="button"
                                onClick={() => goToJob(entry.jobId as string)}
                                style={{
                                  font: 'inherit',
                                  fontFamily: 'var(--mono)',
                                  fontSize: 12,
                                  color: 'var(--accent)',
                                  background: 'none',
                                  border: 'none',
                                  padding: 0,
                                  cursor: 'pointer',
                                  textDecoration: 'underline',
                                }}
                                title={`View job ${entry.jobId}`}
                              >
                                {entry.jobId}
                              </button>
                            ) : (
                              '—'
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {nextCursor && (
                <button
                  type="button"
                  className="btn ghost"
                  style={{ marginTop: 16 }}
                  disabled={loadingMore}
                  onClick={() => void loadLedger(selectedStore.id, nextCursor)}
                >
                  {loadingMore ? 'Loading…' : 'Load more'}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Mobile & Tablet Detail View */}
        <div className="mobile-only" style={{ gap: 14 }}>
          {/* Summary Card */}
          <div
            className="card"
            style={{
              padding: '14px',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r)',
              background: 'var(--surface)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>Credit balance:</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>
                {selectedStore.balance.toLocaleString()}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>Jobs generated:</span>
              <span className="mono" style={{ fontSize: 12, color: 'var(--ink)' }}>
                {selectedStore.jobsCount.toLocaleString()}
              </span>
            </div>
            {selectedStore.failedJobsCount > 0 && (
              <div
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              >
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>Failed jobs:</span>
                {selectedStore.shopEmail ? (
                  <button
                    type="button"
                    className="badge danger"
                    style={{ cursor: 'pointer', border: 'none' }}
                    onClick={() => goToFailedJobs(selectedStore)}
                  >
                    {selectedStore.failedJobsCount.toLocaleString()}
                  </button>
                ) : (
                  <span className="badge danger">
                    {selectedStore.failedJobsCount.toLocaleString()}
                  </span>
                )}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>Installed:</span>
              <DateBadge value={selectedStore.installedAt} kind="installed" align="flex-end" />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>Uninstalled:</span>
              <DateBadge value={selectedStore.uninstalledAt} kind="uninstalled" align="flex-end" />
            </div>
          </div>

          {/* Shop details Card */}
          <div
            className="card"
            style={{
              padding: '14px',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r)',
              background: 'var(--surface)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>Owner:</span>
              <span
                style={{
                  fontSize: 12,
                  color: selectedStore.shopOwnerName ? 'var(--ink)' : 'var(--muted)',
                  textAlign: 'right',
                }}
              >
                {selectedStore.shopOwnerName ?? '—'}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>Phone:</span>
              <span
                style={{
                  fontSize: 12,
                  color: selectedStore.shopPhone ? 'var(--ink)' : 'var(--muted)',
                  textAlign: 'right',
                }}
              >
                {selectedStore.shopPhone ?? '—'}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>Address:</span>
              <span
                style={{
                  fontSize: 12,
                  color: selectedStore.shopAddress ? 'var(--ink)' : 'var(--muted)',
                  textAlign: 'right',
                  wordBreak: 'break-word',
                  maxWidth: '60%',
                }}
              >
                {selectedStore.shopAddress ?? '—'}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>Timezone:</span>
              <span
                style={{
                  fontSize: 12,
                  color: selectedStore.ianaTimezone ? 'var(--ink)' : 'var(--muted)',
                }}
              >
                {selectedStore.ianaTimezone ?? '—'}
              </span>
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              margin: '8px 0 0',
            }}
          >
            <h3 style={{ fontSize: 13.5, fontWeight: 600, margin: 0, color: 'var(--ink)' }}>
              Jobs
            </h3>
            {selectedStore.shopEmail && (
              <button
                type="button"
                className="btn sm ghost"
                onClick={() => goToStoreJobs(selectedStore)}
              >
                View all &rarr;
              </button>
            )}
          </div>

          {jobsLoading ? (
            <div
              className="card"
              style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}
            >
              Loading jobs…
            </div>
          ) : storeJobs.length === 0 ? (
            <div
              className="card"
              style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}
            >
              No jobs yet.
            </div>
          ) : (
            storeJobs.map((job) => (
              <button
                type="button"
                key={job.id}
                onClick={() => goToJob(job.id)}
                className="card"
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--r)',
                  background: 'var(--surface)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  textAlign: 'left',
                  cursor: 'pointer',
                  font: 'inherit',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 10,
                  }}
                >
                  <span
                    className="mono"
                    style={{ fontSize: 12, color: 'var(--ink)' }}
                  >{`${job.id.slice(0, 8)}…`}</span>
                  <StatusBadge status={job.status} />
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: 12,
                    color: 'var(--muted)',
                  }}
                >
                  <span>{formatDate(job.createdAt)}</span>
                  <span>
                    {job.creditsCharged} credits
                    {fmtJobDuration(job) ? ` · ${fmtJobDuration(job)}` : ''}
                  </span>
                </div>
              </button>
            ))
          )}
          {jobsNextCursor && (
            <button
              type="button"
              className="btn ghost"
              style={{ width: '100%' }}
              disabled={jobsLoadingMore}
              onClick={() => void loadStoreJobs(selectedStore.id, jobsNextCursor as string)}
            >
              {jobsLoadingMore ? 'Loading…' : 'Load more'}
            </button>
          )}

          <h3 style={{ fontSize: 13.5, fontWeight: 600, margin: '8px 0 0', color: 'var(--ink)' }}>
            Credit activity
          </h3>

          {ledgerLoading ? (
            <div
              className="card"
              style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}
            >
              Loading activity…
            </div>
          ) : ledger.length === 0 ? (
            <div
              className="card"
              style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}
            >
              No ledger entries yet.
            </div>
          ) : (
            ledger.map((entry) => (
              <div
                key={entry.id}
                className="card"
                style={{
                  padding: '12px 14px',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--r)',
                  background: 'var(--surface)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                {/* 1. Reason & 2. Delta */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 10,
                  }}
                >
                  <span style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--ink)' }}>
                    {entry.reason}
                  </span>
                  <span
                    style={{
                      fontWeight: 700,
                      fontSize: 13.5,
                      color: entry.delta < 0 ? 'var(--danger)' : 'var(--success)',
                    }}
                  >
                    {signedDelta(entry.delta)}
                  </span>
                </div>

                {/* 3. Timestamp */}
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {formatDate(entry.createdAt)}
                </div>

                {/* 4. Job ID */}
                <div style={{ fontSize: 11, wordBreak: 'break-all' }}>
                  {entry.jobId ? (
                    <span style={{ color: 'var(--muted)' }}>
                      Job ID:{' '}
                      <button
                        type="button"
                        onClick={() => goToJob(entry.jobId as string)}
                        style={{
                          font: 'inherit',
                          fontFamily: 'var(--mono)',
                          color: 'var(--accent)',
                          background: 'none',
                          border: 'none',
                          padding: 0,
                          cursor: 'pointer',
                          textDecoration: 'underline',
                        }}
                      >
                        {entry.jobId}
                      </button>
                    </span>
                  ) : (
                    <span style={{ color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
                      Job ID: —
                    </span>
                  )}
                </div>
              </div>
            ))
          )}

          {nextCursor && (
            <button
              type="button"
              className="btn ghost"
              style={{ width: '100%', marginTop: 8 }}
              disabled={loadingMore}
              onClick={() => void loadLedger(selectedStore.id, nextCursor)}
            >
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          )}
        </div>

        {confirmDelete && (
          <div className="modal-overlay" onClick={closeConfirm}>
            <div className="modal confirm" onClick={(e) => e.stopPropagation()}>
              <div className="modal-head">
                <h3>Delete Shopify store</h3>
              </div>
              <div className="modal-body">
                <p>
                  Permanently delete <strong>{confirmDelete.shopDomain}</strong> and all its data —
                  credit balance, ledger, synced products, shoppers, and settings? This cannot be
                  undone. Use this only to reset a test store for a clean reinstall.
                </p>
              </div>
              <div className="modal-foot">
                <button className="btn ghost" onClick={closeConfirm} disabled={deleting}>
                  Cancel
                </button>
                <button className="btn danger" onClick={handleDeleteConfirm} disabled={deleting}>
                  {deleting ? 'Deleting…' : 'Confirm delete'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 600 }}>Shopify Dashboard</h2>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)' }}>
          Store credit balances and credit activity. Open a store for the option to delete it.
        </p>
      </div>

      <div className="card">
        <div className="card-body">
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 10,
              marginBottom: 16,
            }}
          >
            <h3 style={{ margin: 0 }}>Merchant growth</h3>
            <div style={{ display: 'flex', gap: 4 }}>
              {(['7', '30', '90', 'all'] as GrowthDayRange[]).map((d) => (
                <button
                  key={d}
                  type="button"
                  className="btn sm ghost"
                  onClick={() => setGrowthDays(d)}
                  style={{
                    background: growthDays === d ? 'var(--bg-2)' : 'transparent',
                    color: growthDays === d ? 'var(--text)' : 'var(--muted)',
                  }}
                >
                  {d === 'all' ? 'All time' : `${d}d`}
                </button>
              ))}
            </div>
          </div>

          {growthLoading || !growth ? (
            <div style={{ color: 'var(--muted)', fontSize: 13, padding: '24px 0' }}>Loading…</div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                <span style={{ fontSize: 28, fontWeight: 700 }}>
                  {growth.endActive.toLocaleString()}
                </span>
                {growth.growthPct !== null && (
                  <span className={`badge ${growth.growthPct >= 0 ? 'success' : 'danger'}`}>
                    {growth.growthPct >= 0 ? '↑' : '↓'} {Math.abs(growth.growthPct)}%
                  </span>
                )}
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {growthDays === 'all' ? 'all time' : `last ${growthDays} days`}
                </span>
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--muted)',
                  textTransform: 'uppercase',
                  letterSpacing: 0.4,
                  margin: '4px 0 8px',
                }}
              >
                Merchants over time
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={growth.series}>
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={shortChartDate}
                    stroke="var(--muted)"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    minTickGap={30}
                  />
                  <YAxis
                    stroke="var(--muted)"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    allowDecimals={false}
                    width={30}
                  />
                  <Tooltip
                    labelFormatter={(v) => shortChartDate(String(v))}
                    formatter={(value) => [value, 'Merchants']}
                    contentStyle={{
                      background: 'var(--surface-2)',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="activeMerchants"
                    stroke="var(--accent)"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                  gap: 16,
                  marginTop: 24,
                }}
              >
                <div
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--r)',
                    background: 'var(--surface-2)',
                    padding: 14,
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600 }}>Installs</div>
                  <div
                    style={{
                      fontSize: 20,
                      fontWeight: 700,
                      margin: '2px 0 8px',
                      color: 'var(--success)',
                    }}
                  >
                    {growth.installsTotal.toLocaleString()}
                  </div>
                  <ResponsiveContainer width="100%" height={120}>
                    <BarChart data={growth.series}>
                      <XAxis
                        dataKey="date"
                        tickFormatter={shortChartDate}
                        stroke="var(--muted)"
                        fontSize={10}
                        tickLine={false}
                        axisLine={false}
                        minTickGap={40}
                      />
                      <Tooltip
                        labelFormatter={(v) => shortChartDate(String(v))}
                        contentStyle={{
                          background: 'var(--surface)',
                          border: '1px solid var(--border)',
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                        cursor={{ fill: 'rgba(128,128,128,0.08)' }}
                      />
                      <Bar dataKey="installs" fill="var(--success)" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--r)',
                    background: 'var(--surface-2)',
                    padding: 14,
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600 }}>Uninstalls</div>
                  <div
                    style={{
                      fontSize: 20,
                      fontWeight: 700,
                      margin: '2px 0 8px',
                      color: 'var(--danger)',
                    }}
                  >
                    {growth.uninstallsTotal.toLocaleString()}
                  </div>
                  <ResponsiveContainer width="100%" height={120}>
                    <BarChart data={growth.series}>
                      <XAxis
                        dataKey="date"
                        tickFormatter={shortChartDate}
                        stroke="var(--muted)"
                        fontSize={10}
                        tickLine={false}
                        axisLine={false}
                        minTickGap={40}
                      />
                      <Tooltip
                        labelFormatter={(v) => shortChartDate(String(v))}
                        contentStyle={{
                          background: 'var(--surface)',
                          border: '1px solid var(--border)',
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                        cursor={{ fill: 'rgba(128,128,128,0.08)' }}
                      />
                      <Bar dataKey="uninstalls" fill="var(--danger)" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Company (internal test installs) vs Customers (real merchants) — split
          on shop email containing "nicedigitals", the only signal we have for
          which is which. */}
      <div className="segmented-control" role="tablist">
        <button
          type="button"
          className={`segmented-btn ${storeSegment === 'all' ? 'active' : ''}`}
          onClick={() => setStoreSegment('all')}
        >
          All stores
          <span className="badge-count">{stores.length.toLocaleString()}</span>
        </button>
        <button
          type="button"
          className={`segmented-btn ${storeSegment === 'company' ? 'active' : ''}`}
          onClick={() => setStoreSegment('company')}
          title={`Shop email contains "${COMPANY_EMAIL_MARKER}"`}
        >
          Company
          <span className="badge-count">{companyCount.toLocaleString()}</span>
        </button>
        <button
          type="button"
          className={`segmented-btn ${storeSegment === 'customers' ? 'active' : ''}`}
          onClick={() => setStoreSegment('customers')}
        >
          Customers
          <span className="badge-count">{(stores.length - companyCount).toLocaleString()}</span>
        </button>
      </div>

      {loading ? (
        <div
          style={{ color: 'var(--muted)', fontSize: 13, padding: '32px 0', textAlign: 'center' }}
        >
          Loading…
        </div>
      ) : filteredStores.length === 0 ? (
        <div
          style={{
            border: '1px dashed var(--border)',
            borderRadius: 8,
            padding: '48px 24px',
            textAlign: 'center',
            color: 'var(--muted)',
            fontSize: 13,
          }}
        >
          {stores.length === 0
            ? 'No Shopify stores yet.'
            : `No ${storeSegment === 'company' ? 'company' : 'customer'} stores match.`}
        </div>
      ) : (
        <>
          {/* Desktop Table View */}
          <div className="desktop-only table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Store</th>
                  <th style={{ paddingLeft: 28 }}>Email</th>
                  <th style={{ textAlign: 'right', paddingLeft: 28, minWidth: 130 }}>
                    Credit balance
                  </th>
                  <th style={{ textAlign: 'right', paddingLeft: 28, minWidth: 110 }}>Jobs</th>
                  <th style={{ paddingLeft: 28, minWidth: 150 }}>Installed</th>
                  <th style={{ paddingLeft: 28, minWidth: 150 }}>Uninstalled</th>
                </tr>
              </thead>
              <tbody>
                {filteredStores.map((store) => (
                  <tr
                    key={store.id}
                    onClick={() => openStore(store)}
                    style={{ cursor: 'pointer' }}
                    title={`View ${store.shopDomain} credit activity`}
                  >
                    <td style={{ fontWeight: 500 }}>
                      <StoreIdentity store={store} />
                    </td>
                    <td
                      style={{
                        paddingLeft: 28,
                        color: store.shopEmail ? undefined : 'var(--muted)',
                      }}
                    >
                      {store.shopEmail ?? '—'}
                    </td>
                    <td style={{ textAlign: 'right', paddingLeft: 28 }}>
                      {store.balance.toLocaleString()}
                    </td>
                    <td style={{ textAlign: 'right', paddingLeft: 28 }}>
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'flex-end',
                          gap: 2,
                        }}
                      >
                        <span className="mono" style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {store.jobsCount.toLocaleString()}
                        </span>
                        {store.failedJobsCount > 0 &&
                          (store.shopEmail ? (
                            <button
                              type="button"
                              className="badge danger"
                              style={{ cursor: 'pointer', border: 'none' }}
                              onClick={(e) => {
                                e.stopPropagation();
                                goToFailedJobs(store);
                              }}
                              title={`View ${store.failedJobsCount} failed job(s) for ${store.shopDomain}`}
                            >
                              {store.failedJobsCount} failed
                            </button>
                          ) : (
                            <span className="badge danger">{store.failedJobsCount} failed</span>
                          ))}
                      </div>
                    </td>
                    <td style={{ paddingLeft: 28 }}>
                      <DateBadge value={store.installedAt} kind="installed" />
                    </td>
                    <td style={{ paddingLeft: 28 }}>
                      <DateBadge value={store.uninstalledAt} kind="uninstalled" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile & Tablet Card View */}
          <div className="mobile-only" style={{ gap: 10 }}>
            {filteredStores.map((store) => {
              const isExpanded = expandedStoreId === store.id;
              return (
                <div
                  key={store.id}
                  className="card"
                  style={{
                    padding: '12px 14px',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--r)',
                    background: 'var(--surface)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                  }}
                >
                  {/* Shop domain header */}
                  <div
                    onClick={() =>
                      isExpanded ? closeAccordion() : setExpandedStoreIdParam(store.id)
                    }
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 10,
                      cursor: 'pointer',
                      userSelect: 'none',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        minWidth: 0,
                        flex: 1,
                      }}
                    >
                      <span
                        style={{
                          fontWeight: 600,
                          fontSize: 13.5,
                          color: 'var(--ink)',
                          wordBreak: 'break-word',
                        }}
                      >
                        <StoreIdentity store={store} />
                      </span>
                      {store.uninstalledAt ? (
                        <span className="badge danger" style={{ fontSize: 10 }}>
                          Uninstalled
                        </span>
                      ) : (
                        <span className="badge success" style={{ fontSize: 10 }}>
                          Active
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        color: 'var(--muted)',
                        transform: isExpanded ? 'rotate(90deg)' : 'none',
                        transition: 'transform 0.15s ease',
                      }}
                    >
                      <Icon.Chevron />
                    </div>
                  </div>

                  {/* Expanded Section: Balance, Installed, Uninstalled, Credit Activity button */}
                  {isExpanded && (
                    <div
                      style={{
                        paddingTop: 10,
                        borderTop: '1px solid var(--border)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <span style={{ fontSize: 12, color: 'var(--muted)' }}>Credit balance:</span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>
                          {store.balance.toLocaleString()} credits
                        </span>
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <span style={{ fontSize: 12, color: 'var(--muted)' }}>Jobs:</span>
                        <span
                          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}
                        >
                          <span className="mono" style={{ color: 'var(--ink)' }}>
                            {store.jobsCount.toLocaleString()}
                          </span>
                          {store.failedJobsCount > 0 &&
                            (store.shopEmail ? (
                              <button
                                type="button"
                                className="badge danger"
                                style={{ cursor: 'pointer', border: 'none', fontSize: 10 }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  goToFailedJobs(store);
                                }}
                              >
                                {store.failedJobsCount} failed
                              </button>
                            ) : (
                              <span className="badge danger" style={{ fontSize: 10 }}>
                                {store.failedJobsCount} failed
                              </span>
                            ))}
                        </span>
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: 8,
                        }}
                      >
                        <span style={{ fontSize: 12, color: 'var(--muted)' }}>Email:</span>
                        <span
                          style={{
                            fontSize: 12,
                            color: store.shopEmail ? 'var(--ink)' : 'var(--muted)',
                            wordBreak: 'break-all',
                            textAlign: 'right',
                          }}
                        >
                          {store.shopEmail ?? '—'}
                        </span>
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <span style={{ fontSize: 12, color: 'var(--muted)' }}>Installed:</span>
                        <DateBadge value={store.installedAt} kind="installed" align="flex-end" />
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <span style={{ fontSize: 12, color: 'var(--muted)' }}>Uninstalled:</span>
                        <DateBadge
                          value={store.uninstalledAt}
                          kind="uninstalled"
                          align="flex-end"
                        />
                      </div>

                      <button
                        type="button"
                        className="btn sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          openStore(store);
                        }}
                        style={{
                          width: '100%',
                          marginTop: 6,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 6,
                        }}
                      >
                        Credit activity &rarr;
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
