import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../components/Icons';
import { ImageLightbox } from '../components/ImageLightbox';
import { KV } from '../components/KV';
import { NameAvatar } from '../components/NameAvatar';
import { Pager } from '../components/Pager';
import { SearchableSelect } from '../components/SearchableSelect';
import { StatusBadge } from '../components/StatusBadge';
import type { SortDir } from '../components/Th';
import { Th } from '../components/Th';
import { useCrumb } from '../context/BreadcrumbContext';
import { useCloseOverlay } from '../hooks/use-close-overlay';
import { useUrlState } from '../hooks/use-url-state';
import { apiErrorMessage, apiFetch, apiFetchBlob } from '../lib/data';
import type { CreditLedgerEntry, CreditPlan, User } from '../types';

const PAGE_SIZE = 20;
// Sentinel planFilter value meaning "any plan except free" — sent to the API
// as excludeFree=true rather than tier=<slug>, since it isn't a real plan slug.
const PAID_PLAN_FILTER = '__paid__';

function adminRoleLabel(role: string | null) {
  if (role === 'SUPER_ADMIN') return 'Super Admin';
  if (role === 'MODERATOR') return 'Moderator';
  if (role === 'SUPPORT') return 'Support';
  return 'Admin';
}
function userLabel(u: {
  displayName: string | null;
  email: string | null;
  username: string | null;
}) {
  return u.displayName ?? u.email ?? u.username ?? 'User';
}
function userContact(u: { email: string | null; username: string | null }) {
  return u.email ?? (u.username ? `@${u.username}` : '—');
}
function hasActiveUnlimitedPlan(u: Pick<User, 'unlimitedPlan'>) {
  return u.unlimitedPlan?.status === 'active' || u.unlimitedPlan?.status === 'expiring_soon';
}

interface JobPreviewInputImages {
  person?: string;
  face?: string;
  background?: string;
  pose?: string;
  upper?: string;
  lower?: string;
  shoe?: string;
}
interface JobPreview {
  id: string;
  status: string;
  jobType?: string;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  outputUrl?: string;
  inputImages?: JobPreviewInputImages;
}

function fmtJobPreviewDuration(j: JobPreview): string | null {
  if (!j.startedAt || !j.completedAt) return null;
  const ms = new Date(j.completedAt).getTime() - new Date(j.startedAt).getTime();
  return `${(ms / 1000).toFixed(1)}s`;
}

interface Props {
  toast: (t: { kind?: 'error' | 'warning' | 'success'; title: string; body?: string }) => void;
}

// Full search/filter/sort/export parity with admin-web's UsersPage — everything
// that reads data. Mutation actions (suspend/delete, grant admin, grant/edit
// merchant, create user, bulk delete/org-tag, credit grant/deduct, plan/device
// limit changes) are deliberately not here: this app is read-only on users.
export default function UsersPage({ toast }: Props) {
  const [userIdParam, setUserIdParam] = useUrlState('user');
  const closeDetail = useCloseOverlay(['user']);
  const [query, setQuery] = useState('');
  const [merchantsOnly, setMerchantsOnly] = useState(false);
  // Applied filters — these drive load()/handleExport() and the active-filter
  // chips. The popover edits a separate draft copy so nothing here changes
  // until "Apply Filters" is clicked.
  const [showBanned, setShowBanned] = useState(false);
  const [planFilter, setPlanFilter] = useState('');
  const [excludeRoleFilter, setExcludeRoleFilter] = useState('');
  const [excludeOrgMembers, setExcludeOrgMembers] = useState(false);
  const [draftShowBanned, setDraftShowBanned] = useState(false);
  const [draftPlanFilter, setDraftPlanFilter] = useState('');
  const [draftExcludeRoleFilter, setDraftExcludeRoleFilter] = useState('');
  const [draftExcludeOrgMembers, setDraftExcludeOrgMembers] = useState(false);
  const [draftExportFrom, setDraftExportFrom] = useState('');
  const [draftExportTo, setDraftExportTo] = useState('');
  const [page, setPage] = useState(0);
  const [sortKey, setSortKey] = useState<keyof User>('createdAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [users, setUsers] = useState<User[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<User | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [tierOptions, setTierOptions] = useState<string[]>([]);
  const [creditActivity, setCreditActivity] = useState<CreditLedgerEntry[]>([]);
  const [creditActivityLoading, setCreditActivityLoading] = useState(false);
  const [showAllCreditActivity, setShowAllCreditActivity] = useState(false);
  const [jobPreviewId, setJobPreviewId] = useUrlState('jobPreview');
  const closeJobPreview = useCloseOverlay(['jobPreview']);
  const [jobPreview, setJobPreview] = useState<JobPreview | null>(null);
  const [jobPreviewLoading, setJobPreviewLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [exportFrom, setExportFrom] = useState('');
  const [exportTo, setExportTo] = useState('');
  const [exportSortDir, setExportSortDir] = useState<'asc' | 'desc'>('desc');
  const [exportingFormat, setExportingFormat] = useState<'pdf' | 'xlsx' | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [menuOpen]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page + 1), pageSize: String(PAGE_SIZE) });
      if (query) params.set('search', query);
      if (merchantsOnly) params.set('merchant', 'true');
      if (showBanned) params.set('showBanned', 'true');
      if (exportFrom) params.set('createdFrom', exportFrom);
      if (exportTo) params.set('createdTo', exportTo);
      if (planFilter === PAID_PLAN_FILTER) params.set('excludeFree', 'true');
      else if (planFilter) params.set('tier', planFilter);
      if (excludeRoleFilter) params.set('excludeAdminRole', excludeRoleFilter);
      if (excludeOrgMembers) params.set('excludeOrganizationMembers', 'true');
      const data = await apiFetch<{ items: User[]; total: number }>(`/admin/users?${params}`);
      setUsers(data.items);
      setTotal(data.total);
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to load users',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    } finally {
      setLoading(false);
    }
  }, [
    page,
    query,
    merchantsOnly,
    showBanned,
    exportFrom,
    exportTo,
    planFilter,
    excludeRoleFilter,
    excludeOrgMembers,
    toast,
  ]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    apiFetch<CreditPlan[]>('/admin/credit-plans')
      .then((rows) => setTierOptions(rows.filter((plan) => plan.isActive).map((plan) => plan.slug)))
      .catch((e) =>
        toast({
          kind: 'error',
          title: 'Failed to load credit plan tiers',
          body: apiErrorMessage(e, 'Please try again.'),
        }),
      );
  }, [toast]);

  const handleSearch = (q: string) => {
    setQuery(q);
    setPage(0);
  };

  const handleExport = async (format: 'pdf' | 'xlsx') => {
    setExportingFormat(format);
    try {
      const params = new URLSearchParams({ sortDir: exportSortDir });
      if (query) params.set('search', query);
      if (merchantsOnly) params.set('merchant', 'true');
      if (showBanned) params.set('showBanned', 'true');
      if (exportFrom) params.set('createdFrom', exportFrom);
      if (exportTo) params.set('createdTo', exportTo);
      if (planFilter === PAID_PLAN_FILTER) params.set('excludeFree', 'true');
      else if (planFilter) params.set('tier', planFilter);
      if (excludeRoleFilter) params.set('excludeAdminRole', excludeRoleFilter);
      if (excludeOrgMembers) params.set('excludeOrganizationMembers', 'true');
      const blob = await apiFetchBlob(`/admin/users/export.${format}?${params}`);
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.download = `users-export-${new Date().toISOString().slice(0, 10)}.${format}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(href);
    } catch (e) {
      toast({
        kind: 'error',
        title: `Failed to export users (${format.toUpperCase()})`,
        body: apiErrorMessage(e, 'Please try again.'),
      });
    } finally {
      setExportingFormat(null);
    }
  };

  const sorted = [...users].sort((a, b) => {
    const aVal = a[sortKey] ?? '';
    const bVal = b[sortKey] ?? '';
    const cmp =
      typeof aVal === 'string'
        ? aVal.localeCompare(bVal as string)
        : (aVal as number) - (bVal as number);
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const handleSort = (k: keyof User) => {
    if (k === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(k);
      setSortDir('asc');
    }
  };

  const loadCreditActivity = useCallback(
    async (userId: string) => {
      setCreditActivityLoading(true);
      try {
        const rows = await apiFetch<CreditLedgerEntry[]>(`/admin/credits/ledger/${userId}`);
        setCreditActivity(rows);
      } catch (e) {
        toast({
          kind: 'error',
          title: 'Failed to load credit activity',
          body: apiErrorMessage(e, 'Please try again.'),
        });
      } finally {
        setCreditActivityLoading(false);
      }
    },
    [toast],
  );

  const openJobPreview = useCallback((jobId: string) => setJobPreviewId(jobId), [setJobPreviewId]);

  useEffect(() => {
    if (!jobPreviewId) {
      setJobPreview(null);
      return;
    }
    let cancelled = false;
    setJobPreview(null);
    setJobPreviewLoading(true);
    apiFetch<JobPreview>(`/admin/jobs/${jobPreviewId}`)
      .then((full) => {
        if (!cancelled) setJobPreview(full);
      })
      .catch((e) => {
        if (!cancelled)
          toast({
            kind: 'error',
            title: 'Failed to load job details',
            body: apiErrorMessage(e, 'Please try again.'),
          });
      })
      .finally(() => {
        if (!cancelled) setJobPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [jobPreviewId, toast]);

  const openDetail = async (u: User) => {
    setDetail(u);
    setShowAllCreditActivity(false);
    if (userIdParam !== u.id) setUserIdParam(u.id);
    setDetailLoading(true);
    try {
      const [full] = await Promise.all([
        apiFetch<User>(`/admin/users/${u.id}`),
        loadCreditActivity(u.id),
      ]);
      setDetail(full);
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to load user detail',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    } finally {
      setDetailLoading(false);
    }
  };

  // Reconstructs the detail view from the URL alone — covers a hard refresh,
  // a deep link, and the physical Back button restoring a previous `user=`
  // value.
  useEffect(() => {
    if (!userIdParam) {
      setDetail(null);
      return;
    }
    if (detail?.id === userIdParam) return;
    let cancelled = false;
    setDetailLoading(true);
    Promise.all([apiFetch<User>(`/admin/users/${userIdParam}`), loadCreditActivity(userIdParam)])
      .then(([full]) => {
        if (cancelled) return;
        setDetail(full);
        setShowAllCreditActivity(false);
      })
      .catch((e) => {
        if (!cancelled)
          toast({
            kind: 'error',
            title: 'Failed to load user detail',
            body: apiErrorMessage(e, 'Please try again.'),
          });
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userIdParam, detail?.id, loadCreditActivity, toast]);

  useCrumb(
    0,
    detail
      ? { label: userLabel(detail), href: `/users?user=${encodeURIComponent(detail.id)}` }
      : null,
  );
  useCrumb(
    1,
    jobPreviewId
      ? {
          label: `Job ${jobPreviewId.slice(0, 8)}…`,
          href: `/users?user=${encodeURIComponent(detail?.id ?? '')}&jobPreview=${encodeURIComponent(jobPreviewId)}`,
        }
      : null,
  );

  if (detail) {
    const u = detail;

    return (
      <>
        <div className="page-head">
          <div>
            <button className="btn ghost" onClick={closeDetail}>
              <Icon.Back /> Back to users
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 12 }}>
              <NameAvatar name={userLabel(u)} email={u.email ?? undefined} size={44} />
              <div>
                <h1 style={{ marginBottom: 2 }}>{userLabel(u)}</h1>
                <p className="lede" style={{ margin: 0 }}>
                  {userContact(u)}
                </p>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
              {u.isAdmin && <span className="badge accent">{adminRoleLabel(u.adminRole)}</span>}
              {u.isOrganizationMember && <span className="badge info">Organization</span>}
              {u.isMerchant && <span className="badge success">Merchant</span>}
              {u.hasShopifyStore && <span className="badge success">Shopify</span>}
              {!u.hasPassword && <span className="badge info">Google account</span>}
              {u.isBanned ? (
                <span className="badge danger dot">Suspended</span>
              ) : (
                <span className="badge success dot">Active</span>
              )}
            </div>
          </div>
        </div>

        {detailLoading ? (
          <p className="sub" style={{ textAlign: 'center', padding: '48px 0' }}>
            Loading user data&hellip;
          </p>
        ) : (
          <>
            <div className="stat-grid">
              <div className="stat">
                <div className="lbl">
                  <Icon.Credit /> Current plan
                </div>
                <div className="val" style={{ textTransform: 'capitalize' }}>
                  {u.tier}
                </div>
              </div>
              {hasActiveUnlimitedPlan(u) ? (
                <div className="stat">
                  <div className="lbl">
                    <Icon.Coin /> Credit balance
                  </div>
                  <div className="val">
                    Monthly{' '}
                    <span
                      className={`badge ${u.unlimitedPlan?.status === 'expiring_soon' ? 'warn' : 'success'} dot`}
                    >
                      {u.unlimitedPlan?.daysRemaining} day
                      {u.unlimitedPlan?.daysRemaining === 1 ? '' : 's'} left
                    </span>
                  </div>
                </div>
              ) : (
                <div className="stat">
                  <div className="lbl">
                    <Icon.Coin /> Credit balance
                  </div>
                  <div className="val">{u.balance.toLocaleString()}</div>
                </div>
              )}
              <div className="stat">
                <div className="lbl">
                  <Icon.Credit /> Monthly plan
                </div>
                <div className="val">
                  {u.unlimitedPlan && u.unlimitedPlan.status !== 'none' ? (
                    <span
                      className={`badge dot ${
                        u.unlimitedPlan.status === 'active'
                          ? 'success'
                          : u.unlimitedPlan.status === 'expiring_soon'
                            ? 'warn'
                            : 'danger'
                      }`}
                    >
                      {u.unlimitedPlan.status === 'active' && 'Active'}
                      {u.unlimitedPlan.status === 'expiring_soon' && 'Expiring soon'}
                      {u.unlimitedPlan.status === 'expired' && 'Expired'}
                      {u.unlimitedPlan.status === 'revoked' && 'Revoked'}
                    </span>
                  ) : (
                    'None'
                  )}
                </div>
              </div>
              <div className="stat">
                <div className="lbl">
                  <Icon.Activity /> Jobs generated
                </div>
                <div className="val">{(u.totalJobs ?? 0).toLocaleString()}</div>
              </div>
              <div className="stat">
                <div className="lbl">
                  <Icon.Monitor /> Device limit
                </div>
                <div className="val">{u.maxActiveDevices}</div>
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <h3>Account details</h3>
              </div>
              <div className="card-body">
                <div className="kv-grid">
                  <KV k="Phone" v={u.phone ? `+91 ${u.phone}` : 'Not provided'} />
                  <KV
                    k="Authentication"
                    v={u.hasPassword ? 'Email and password' : 'Google account'}
                  />
                  <KV k="Joined" v={new Date(u.createdAt).toLocaleString()} />
                  <KV
                    k="Last job"
                    v={u.lastJobAt ? new Date(u.lastJobAt).toLocaleString() : 'No activity'}
                  />
                  <KV
                    k="User ID"
                    v={
                      <span title={u.id}>
                        {u.id.slice(0, 8)}…{u.id.slice(-6)}
                      </span>
                    }
                    mono
                  />
                  {u.isBanned && <KV k="Suspension" v={u.banReason || 'No reason provided'} />}
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <h3>Merchant access</h3>
              </div>
              <div className="card-body">
                {!u.merchant ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <span
                      style={{
                        display: 'grid',
                        placeItems: 'center',
                        width: 38,
                        height: 38,
                        borderRadius: 10,
                        background: 'var(--surface-2)',
                        color: 'var(--muted-2)',
                        flexShrink: 0,
                      }}
                    >
                      <Icon.Shield />
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="semi">No merchant access</div>
                      <div className="sub">This account has no merchant catalogue access.</div>
                    </div>
                  </div>
                ) : (
                  <div className="kv-grid-3-col">
                    <KV
                      k="Status"
                      v={<StatusBadge status={u.merchant.isActive ? 'active' : 'inactive'} />}
                    />
                    <KV k="Company" v={u.merchant.companyName} />
                    <KV k="Contact" v={u.merchant.contactName || '—'} />
                    <KV k="Phone" v={u.merchant.phone || '—'} />
                    <KV k="Demo data" v={u.merchant.demoData ? 'Enabled' : 'Disabled'} />
                  </div>
                )}
              </div>
            </div>

            <div className="card" style={{ overflow: 'hidden' }}>
              <div className="card-head">
                <div>
                  <h3>Credit activity</h3>
                  <span className="sub">
                    {showAllCreditActivity
                      ? `All ${creditActivity.length} ledger entries`
                      : 'Latest five ledger entries'}
                  </span>
                </div>
                {creditActivity.length > 5 && (
                  <button
                    className="btn sm ghost"
                    onClick={() => setShowAllCreditActivity((v) => !v)}
                  >
                    {showAllCreditActivity ? 'Show less' : `Show all (${creditActivity.length})`}{' '}
                    <Icon.Chevron />
                  </button>
                )}
              </div>
              <div className="table-wrap" style={{ border: 0, borderRadius: 0 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Reason</th>
                      <th>Delta</th>
                      <th>Job</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {creditActivityLoading ? (
                      <tr>
                        <td
                          colSpan={4}
                          style={{ textAlign: 'center', color: 'var(--muted)', padding: '2rem' }}
                        >
                          Loading&hellip;
                        </td>
                      </tr>
                    ) : creditActivity.length ? (
                      (showAllCreditActivity ? creditActivity : creditActivity.slice(0, 5)).map(
                        (l) => (
                          <tr key={l.id}>
                            <td>{l.reason}</td>
                            <td>
                              <span
                                className="mono"
                                style={{
                                  color: l.delta < 0 ? 'var(--danger)' : 'var(--success, #4caf50)',
                                }}
                              >
                                {l.delta > 0 ? '+' : ''}
                                {l.delta.toLocaleString()}
                              </span>
                            </td>
                            <td>
                              {l.jobId ? (
                                <span
                                  className="mono sub"
                                  style={{ cursor: 'pointer' }}
                                  title="Open job details"
                                  onClick={() => openJobPreview(l.jobId as string)}
                                >
                                  {l.jobId.slice(0, 8)}&hellip;
                                </span>
                              ) : (
                                '—'
                              )}
                            </td>
                            <td>{new Date(l.createdAt).toLocaleString()}</td>
                          </tr>
                        ),
                      )
                    ) : (
                      <tr>
                        <td
                          colSpan={4}
                          style={{ textAlign: 'center', color: 'var(--muted)', padding: '2rem' }}
                        >
                          No credit activity.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {jobPreviewId && (
          <div className="modal-overlay" onClick={closeJobPreview}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-head">
                <h3 style={{ fontFamily: 'var(--mono)', fontSize: 13 }}>
                  Job {jobPreviewId.slice(0, 8)}&hellip;
                </h3>
                {jobPreview && (
                  <span style={{ marginLeft: 'auto' }}>
                    <StatusBadge status={jobPreview.status} />
                  </span>
                )}
              </div>
              <div className="modal-body">
                {jobPreviewLoading ? (
                  <p style={{ color: 'var(--muted)', fontSize: 13 }}>Loading&hellip;</p>
                ) : jobPreview ? (
                  <>
                    <div
                      style={{
                        display: 'flex',
                        gap: 20,
                        marginBottom: 14,
                        fontSize: 12.5,
                        color: 'var(--muted)',
                      }}
                    >
                      <span>Created {new Date(jobPreview.createdAt).toLocaleString()}</span>
                      <span>Duration {fmtJobPreviewDuration(jobPreview) ?? '—'}</span>
                    </div>
                    {jobPreview.outputUrl && (
                      <div className="card" style={{ marginBottom: 14 }}>
                        <div className="card-head">
                          <h3>Output</h3>
                        </div>
                        <div className="card-body">
                          <a
                            href={jobPreview.outputUrl}
                            rel="noreferrer"
                            className="link"
                            onClick={(e) => {
                              e.preventDefault();
                              setPreviewUrl(jobPreview.outputUrl ?? null);
                            }}
                          >
                            View output <Icon.ExternalLink />
                          </a>
                        </div>
                      </div>
                    )}
                    {jobPreview.inputImages &&
                      Object.values(jobPreview.inputImages).some(Boolean) && (
                        <div className="card">
                          <div className="card-head">
                            <h3>Input Images</h3>
                          </div>
                          <div className="card-body">
                            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                              {(
                                [
                                  { key: 'person', label: 'Person' },
                                  { key: 'face', label: 'Face (ComfyUI)' },
                                  { key: 'background', label: 'Background (ComfyUI)' },
                                  { key: 'pose', label: 'Pose' },
                                  { key: 'upper', label: 'Upper Garment' },
                                  { key: 'lower', label: 'Lower Garment' },
                                  { key: 'shoe', label: 'Shoes' },
                                ] as { key: keyof JobPreviewInputImages; label: string }[]
                              ).map(({ key, label }) => {
                                const url = jobPreview.inputImages?.[key];
                                if (!url) return null;
                                return (
                                  <div key={key} style={{ textAlign: 'center' }}>
                                    <a
                                      href={url}
                                      rel="noreferrer"
                                      style={{ textDecoration: 'none' }}
                                      onClick={(e) => {
                                        e.preventDefault();
                                        setPreviewUrl(url);
                                      }}
                                    >
                                      {/* biome-ignore lint/performance/noImgElement: support panel */}
                                      <img
                                        src={url}
                                        alt={label}
                                        style={{
                                          width: 96,
                                          height: 96,
                                          objectFit: 'cover',
                                          borderRadius: 8,
                                          border: '1px solid var(--border)',
                                          display: 'block',
                                          cursor: 'zoom-in',
                                        }}
                                        onError={(e) => {
                                          (e.target as HTMLImageElement).style.display = 'none';
                                        }}
                                      />
                                      <span
                                        style={{
                                          fontSize: 11,
                                          color: 'var(--muted)',
                                          marginTop: 4,
                                          display: 'block',
                                        }}
                                      >
                                        {label}
                                      </span>
                                    </a>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      )}
                    {!jobPreview.outputUrl &&
                      (!jobPreview.inputImages ||
                        !Object.values(jobPreview.inputImages).some(Boolean)) && (
                        <p style={{ color: 'var(--muted)', fontSize: 13 }}>
                          No input or output images for this job.
                        </p>
                      )}
                  </>
                ) : (
                  <p style={{ color: 'var(--muted)', fontSize: 13 }}>Job not found.</p>
                )}
              </div>
              <div className="modal-foot">
                <button className="btn ghost" onClick={closeJobPreview}>
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {previewUrl && <ImageLightbox url={previewUrl} onClose={() => setPreviewUrl(null)} />}
      </>
    );
  }

  const hasActiveFilters = Boolean(
    query ||
      merchantsOnly ||
      showBanned ||
      exportFrom ||
      exportTo ||
      planFilter ||
      excludeRoleFilter ||
      excludeOrgMembers,
  );
  const clearFilters = () => {
    setQuery('');
    setMerchantsOnly(false);
    setShowBanned(false);
    setExportFrom('');
    setExportTo('');
    setPlanFilter('');
    setExcludeRoleFilter('');
    setExcludeOrgMembers(false);
    setDraftShowBanned(false);
    setDraftExportFrom('');
    setDraftExportTo('');
    setDraftPlanFilter('');
    setDraftExcludeRoleFilter('');
    setDraftExcludeOrgMembers(false);
    setPage(0);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Users</h1>
          <p className="lede">
            {loading ? 'Loading…' : `${total.toLocaleString()} accounts`} — search and review user
            accounts, credit plans, and merchant catalogue access.
          </p>
        </div>
      </div>

      <div className="filter-card" style={{ marginBottom: 16 }}>
        <div className="filter-row">
          <div className="segmented-control" role="tablist">
            <button
              type="button"
              className={`segmented-btn ${!merchantsOnly ? 'active' : ''}`}
              onClick={() => {
                setMerchantsOnly(false);
                setPage(0);
              }}
            >
              All users
              <span className="badge-count">{total.toLocaleString()}</span>
            </button>
            <button
              type="button"
              className={`segmented-btn ${merchantsOnly ? 'active' : ''}`}
              onClick={() => {
                setMerchantsOnly(true);
                setPage(0);
              }}
            >
              Merchants
            </button>
          </div>

          <div className="filter-search-box">
            <Icon.Search />
            <input
              placeholder="Search by name, email, or username…"
              value={query}
              onChange={(e) => handleSearch(e.target.value)}
            />
            {query && (
              <button
                type="button"
                className="filter-clear-btn"
                onClick={() => handleSearch('')}
                title="Clear search"
              >
                <Icon.Close />
              </button>
            )}
          </div>

          <div ref={menuRef} className="filter-popover-wrapper">
            <button
              type="button"
              className={`filter-toggle-btn ${menuOpen || showBanned || exportFrom || exportTo || planFilter || excludeRoleFilter || excludeOrgMembers ? 'active' : ''}`}
              onClick={() => {
                if (!menuOpen) {
                  setDraftShowBanned(showBanned);
                  setDraftPlanFilter(planFilter);
                  setDraftExcludeRoleFilter(excludeRoleFilter);
                  setDraftExcludeOrgMembers(excludeOrgMembers);
                  setDraftExportFrom(exportFrom);
                  setDraftExportTo(exportTo);
                }
                setMenuOpen(!menuOpen);
              }}
              title="Filters & Export options"
            >
              <Icon.Filter />
              <span>Options</span>
              {(showBanned ||
                exportFrom ||
                exportTo ||
                planFilter ||
                excludeRoleFilter ||
                excludeOrgMembers) && (
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: 'var(--accent)',
                    display: 'inline-block',
                  }}
                />
              )}
            </button>

            {menuOpen && (
              <div className="filter-popover-menu">
                <div>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: 'var(--muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      display: 'block',
                      marginBottom: 6,
                    }}
                  >
                    Joined Date Range
                  </span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 12, color: 'var(--muted)', width: 40 }}>From:</span>
                      <input
                        type="date"
                        className="filter-input"
                        value={draftExportFrom}
                        onChange={(e) => setDraftExportFrom(e.target.value)}
                        style={{ flex: 1, height: 32, fontSize: 12 }}
                      />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 12, color: 'var(--muted)', width: 40 }}>To:</span>
                      <input
                        type="date"
                        className="filter-input"
                        value={draftExportTo}
                        onChange={(e) => setDraftExportTo(e.target.value)}
                        style={{ flex: 1, height: 32, fontSize: 12 }}
                      />
                    </div>
                  </div>
                </div>

                <div style={{ borderTop: '1px solid var(--border)' }} />

                <div>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: 'var(--muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      display: 'block',
                      marginBottom: 6,
                    }}
                  >
                    Plan
                  </span>
                  <SearchableSelect
                    options={[
                      { id: PAID_PLAN_FILTER, label: 'Any paid plan' },
                      ...tierOptions.map((slug) => ({ id: slug, label: slug })),
                    ]}
                    value={draftPlanFilter}
                    onChange={(v) => setDraftPlanFilter(v)}
                    emptyLabel="All plans"
                    style={{ width: '100%', height: 32, fontSize: 12.5 }}
                  />
                </div>

                <div style={{ borderTop: '1px solid var(--border)' }} />

                <div>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: 'var(--muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      display: 'block',
                      marginBottom: 6,
                    }}
                  >
                    Exclude Admin Role
                  </span>
                  <SearchableSelect
                    options={[
                      { id: 'ALL', label: 'All (any admin role)' },
                      { id: 'SUPER_ADMIN', label: 'Super Admin' },
                      { id: 'ADMIN', label: 'Admin' },
                      { id: 'MODERATOR', label: 'Moderator' },
                      { id: 'SUPPORT', label: 'Support' },
                    ]}
                    value={draftExcludeRoleFilter}
                    onChange={(v) => setDraftExcludeRoleFilter(v)}
                    emptyLabel="Don't exclude anyone"
                    style={{ width: '100%', height: 32, fontSize: 12.5 }}
                  />
                </div>

                <div style={{ borderTop: '1px solid var(--border)' }} />

                <div>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: 'var(--muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      display: 'block',
                      marginBottom: 6,
                    }}
                  >
                    Organization
                  </span>
                  <button
                    type="button"
                    className={`filter-toggle-btn ${draftExcludeOrgMembers ? 'active' : ''}`}
                    onClick={() => setDraftExcludeOrgMembers(!draftExcludeOrgMembers)}
                    style={{
                      width: '100%',
                      justifyContent: 'flex-start',
                      height: 32,
                      fontSize: 12.5,
                    }}
                  >
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        background: draftExcludeOrgMembers ? 'var(--accent)' : 'var(--muted)',
                        display: 'inline-block',
                      }}
                    />
                    Exclude organization members
                  </button>
                </div>

                <div style={{ borderTop: '1px solid var(--border)' }} />

                <div>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: 'var(--muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      display: 'block',
                      marginBottom: 6,
                    }}
                  >
                    User Status
                  </span>
                  <button
                    type="button"
                    className={`filter-toggle-btn ${draftShowBanned ? 'active' : ''}`}
                    onClick={() => setDraftShowBanned(!draftShowBanned)}
                    style={{
                      width: '100%',
                      justifyContent: 'flex-start',
                      height: 32,
                      fontSize: 12.5,
                    }}
                  >
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        background: draftShowBanned ? 'var(--accent)' : 'var(--muted)',
                        display: 'inline-block',
                      }}
                    />
                    Show suspended/deleted
                  </button>
                </div>

                <div style={{ borderTop: '1px solid var(--border)' }} />

                <button
                  type="button"
                  className="btn primary sm"
                  style={{ width: '100%', justifyContent: 'center', height: 36 }}
                  onClick={() => {
                    setShowBanned(draftShowBanned);
                    setPlanFilter(draftPlanFilter);
                    setExcludeRoleFilter(draftExcludeRoleFilter);
                    setExcludeOrgMembers(draftExcludeOrgMembers);
                    setExportFrom(draftExportFrom);
                    setExportTo(draftExportTo);
                    setPage(0);
                    setMenuOpen(false);
                  }}
                >
                  Apply Filters
                </button>

                <div style={{ borderTop: '1px solid var(--border)' }} />

                <div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: 6,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: 'var(--muted)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                      }}
                    >
                      Export Data
                    </span>
                    <SearchableSelect
                      options={[
                        { id: 'desc', label: 'Newest first' },
                        { id: 'asc', label: 'Oldest first' },
                      ]}
                      value={exportSortDir}
                      onChange={(v) => setExportSortDir(v as 'asc' | 'desc')}
                      style={{ height: 24, fontSize: 11 }}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                    <button
                      type="button"
                      className="btn sm ghost"
                      onClick={() => {
                        handleExport('pdf');
                        setMenuOpen(false);
                      }}
                      disabled={exportingFormat !== null}
                      style={{ flex: 1, justifyContent: 'center' }}
                      title="Download PDF report"
                    >
                      <Icon.Download /> {exportingFormat === 'pdf' ? 'Exporting…' : 'PDF'}
                    </button>
                    <button
                      type="button"
                      className="btn sm ghost"
                      onClick={() => {
                        handleExport('xlsx');
                        setMenuOpen(false);
                      }}
                      disabled={exportingFormat !== null}
                      style={{ flex: 1, justifyContent: 'center' }}
                      title="Download Excel spreadsheet"
                    >
                      <Icon.Download /> {exportingFormat === 'xlsx' ? 'Exporting…' : 'Excel'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {hasActiveFilters && (
            <button
              type="button"
              className="btn sm ghost"
              onClick={clearFilters}
              style={{ marginLeft: 'auto' }}
            >
              <Icon.Close /> Clear filters
            </button>
          )}
        </div>

        {hasActiveFilters && (
          <div className="filter-chips-row">
            <span style={{ color: 'var(--muted)', fontSize: 11.5, marginRight: 2 }}>Active:</span>
            {query && (
              <span className="filter-chip">
                Search: <strong>"{query}"</strong>
                <button
                  type="button"
                  className="filter-chip-remove"
                  onClick={() => handleSearch('')}
                >
                  <Icon.Close />
                </button>
              </span>
            )}
            {merchantsOnly && (
              <span className="filter-chip">
                Filter: <strong>Merchants only</strong>
                <button
                  type="button"
                  className="filter-chip-remove"
                  onClick={() => {
                    setMerchantsOnly(false);
                    setPage(0);
                  }}
                >
                  <Icon.Close />
                </button>
              </span>
            )}
            {showBanned && (
              <span className="filter-chip">
                Status: <strong>Suspended/deleted only</strong>
                <button
                  type="button"
                  className="filter-chip-remove"
                  onClick={() => {
                    setShowBanned(false);
                    setDraftShowBanned(false);
                    setPage(0);
                  }}
                >
                  <Icon.Close />
                </button>
              </span>
            )}
            {(exportFrom || exportTo) && (
              <span className="filter-chip">
                Joined:{' '}
                <strong>
                  {exportFrom || 'Any'} → {exportTo || 'Today'}
                </strong>
                <button
                  type="button"
                  className="filter-chip-remove"
                  onClick={() => {
                    setExportFrom('');
                    setExportTo('');
                    setDraftExportFrom('');
                    setDraftExportTo('');
                    setPage(0);
                  }}
                >
                  <Icon.Close />
                </button>
              </span>
            )}
            {planFilter && (
              <span className="filter-chip">
                Plan:{' '}
                <strong style={{ textTransform: 'capitalize' }}>
                  {planFilter === PAID_PLAN_FILTER ? 'Any paid plan' : planFilter}
                </strong>
                <button
                  type="button"
                  className="filter-chip-remove"
                  onClick={() => {
                    setPlanFilter('');
                    setDraftPlanFilter('');
                    setPage(0);
                  }}
                >
                  <Icon.Close />
                </button>
              </span>
            )}
            {excludeRoleFilter && (
              <span className="filter-chip">
                Excluding:{' '}
                <strong>
                  {excludeRoleFilter === 'ALL' ? 'All admins' : adminRoleLabel(excludeRoleFilter)}
                </strong>
                <button
                  type="button"
                  className="filter-chip-remove"
                  onClick={() => {
                    setExcludeRoleFilter('');
                    setDraftExcludeRoleFilter('');
                    setPage(0);
                  }}
                >
                  <Icon.Close />
                </button>
              </span>
            )}
            {excludeOrgMembers && (
              <span className="filter-chip">
                Filter: <strong>Excluding organization members</strong>
                <button
                  type="button"
                  className="filter-chip-remove"
                  onClick={() => {
                    setExcludeOrgMembers(false);
                    setDraftExcludeOrgMembers(false);
                    setPage(0);
                  }}
                >
                  <Icon.Close />
                </button>
              </span>
            )}
          </div>
        )}
      </div>

      {loading ? (
        <p style={{ color: 'var(--muted)', fontSize: 13, padding: '20px 0' }}>
          Loading users&hellip;
        </p>
      ) : (
        <>
          <div className="desktop-only table-wrap">
            <table>
              <thead>
                <tr>
                  <Th k="displayName" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>
                    User
                  </Th>
                  <Th k="tier" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>
                    Plan
                  </Th>
                  <th>Access</th>
                  <th>Signup</th>
                  <Th k="balance" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>
                    Credits
                  </Th>
                  <Th k="totalJobs" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>
                    Jobs
                  </Th>
                  <Th k="lastJobAt" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>
                    Last activity
                  </Th>
                  <Th k="createdAt" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>
                    Joined
                  </Th>
                  <Th k="isBanned" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>
                    Status
                  </Th>
                  <th aria-label="Open user"></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((u) => (
                  <tr
                    key={u.id}
                    onClick={() => openDetail(u)}
                    style={{ cursor: 'pointer', opacity: u.isBanned ? 0.6 : 1 }}
                  >
                    <td>
                      <div
                        style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 220 }}
                      >
                        <NameAvatar name={userLabel(u)} email={u.email ?? undefined} size={32} />
                        <div style={{ minWidth: 0 }}>
                          <div
                            className="semi"
                            style={{
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {userLabel(u)}
                          </div>
                          {u.displayName && (
                            <div
                              className="sub"
                              style={{
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {userContact(u)}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="badge" style={{ textTransform: 'capitalize' }}>
                        {u.tier}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {u.isAdmin && (
                          <span className="badge accent">
                            {u.adminRole === 'SUPER_ADMIN' ? 'Super Admin' : 'Admin'}
                          </span>
                        )}
                        {u.isMerchant && <span className="badge success">Merchant</span>}
                        {u.hasShopifyStore && <span className="badge success">Shopify</span>}
                        {!u.hasPassword && <span className="badge info">Google</span>}
                        {!u.isAdmin && !u.isMerchant && u.hasPassword && (
                          <span className="sub">Standard</span>
                        )}
                      </div>
                    </td>
                    <td>
                      {u.isMerchant ? (
                        u.signupSource === 'android_google' ? (
                          <span className="badge warn">Self-signup</span>
                        ) : (
                          <span className="badge">Admin</span>
                        )
                      ) : (
                        <span className="sub">&mdash;</span>
                      )}
                    </td>
                    <td>
                      {hasActiveUnlimitedPlan(u) ? (
                        <span
                          className={`badge dot ${u.unlimitedPlan?.status === 'expiring_soon' ? 'warn' : 'success'}`}
                        >
                          Monthly
                        </span>
                      ) : (
                        <span className="mono" style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {u.balance.toLocaleString()}
                        </span>
                      )}
                    </td>
                    <td>
                      <span className="mono" style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {(u.totalJobs ?? 0).toLocaleString()}
                      </span>
                    </td>
                    <td>
                      <span className="sub">
                        {u.lastJobAt ? new Date(u.lastJobAt).toLocaleDateString() : 'No activity'}
                      </span>
                    </td>
                    <td>
                      <span className="sub">{new Date(u.createdAt).toLocaleDateString()}</span>
                    </td>
                    <td>
                      {u.isBanned ? (
                        <span className="badge danger dot">Suspended</span>
                      ) : (
                        <span className="badge success dot">Active</span>
                      )}
                    </td>
                    <td>
                      <span style={{ color: 'var(--muted-2)' }} aria-hidden="true">
                        <Icon.Chevron />
                      </span>
                    </td>
                  </tr>
                ))}
                {sorted.length === 0 && (
                  <tr>
                    <td
                      colSpan={10}
                      style={{ textAlign: 'center', color: 'var(--muted)', padding: '2.5rem' }}
                    >
                      No users found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mobile-only" style={{ gap: 12 }}>
            {sorted.map((u) => (
              <button
                type="button"
                key={u.id}
                onClick={() => openDetail(u)}
                className="card"
                style={{
                  padding: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                  cursor: 'pointer',
                  userSelect: 'none',
                  opacity: u.isBanned ? 0.6 : 1,
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  background: 'var(--surface)',
                  width: '100%',
                  textAlign: 'left',
                  color: 'inherit',
                  fontFamily: 'inherit',
                  fontSize: 'inherit',
                }}
              >
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}
                >
                  <NameAvatar name={userLabel(u)} email={u.email ?? undefined} size={32} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      className="semi"
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontSize: 14,
                      }}
                    >
                      {userLabel(u)}
                    </div>
                    <div
                      className="sub"
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontSize: 11,
                        display: 'flex',
                        gap: 6,
                        alignItems: 'center',
                      }}
                    >
                      <span style={{ textTransform: 'capitalize' }}>{u.tier}</span>
                      <span>&middot;</span>
                      {hasActiveUnlimitedPlan(u) ? (
                        <span className="mono">Monthly</span>
                      ) : (
                        <span className="mono">{u.balance.toLocaleString()} credits</span>
                      )}
                    </div>
                  </div>
                </div>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-end',
                    gap: 4,
                    flexShrink: 0,
                  }}
                >
                  {u.isBanned ? (
                    <span className="badge danger dot">Suspended</span>
                  ) : (
                    <span className="badge success dot">Active</span>
                  )}
                  {u.isAdmin && (
                    <span className="badge accent" style={{ fontSize: 10 }}>
                      {u.adminRole === 'SUPER_ADMIN' ? 'Super Admin' : 'Admin'}
                    </span>
                  )}
                  {u.isMerchant && (
                    <span className="badge success" style={{ fontSize: 10 }}>
                      Merchant
                    </span>
                  )}
                </div>
              </button>
            ))}
            {sorted.length === 0 && (
              <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '2rem' }}>
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
    </>
  );
}
