import { useCallback, useEffect, useState } from 'react';
import { Icon } from '../components/Icons';
import { JobTypeBadge } from '../components/JobTypeBadge';
import { KV } from '../components/KV';
import { Pager } from '../components/Pager';
import { StatusBadge } from '../components/StatusBadge';
import type { SortDir } from '../components/Th';
import { Th } from '../components/Th';
import { useAdminJobStream } from '../hooks/use-admin-job-stream';
import { apiErrorMessage, apiFetch, apiFetchBlob } from '../lib/data';
import type { Job } from '../types';

const PAGE_SIZE = 25;

const FILTERS = [
  { k: 'all', l: 'All' },
  { k: 'QUEUED', l: 'Queued' },
  { k: 'GENERATING', l: 'Generating' },
  { k: 'COMPLETED', l: 'Completed' },
  { k: 'FAILED', l: 'Failed' },
  { k: 'CANCELLED', l: 'Cancelled' },
] as const;

type FilterKey = 'all' | 'QUEUED' | 'GENERATING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

interface JobEvent {
  id: string;
  eventType: string;
  payload: unknown;
  createdAt: string;
}

interface InputImages {
  person?: string;
  face?: string;
  background?: string;
  pose?: string;
  upper?: string;
  lower?: string;
  shoe?: string;
}

interface JobDetail extends Job {
  events?: JobEvent[];
  inputImages?: InputImages;
  workflowLabel?: string | null;
}

function EventRow({ ev }: { ev: JobEvent }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const hasPayload = ev.payload != null && Object.keys(ev.payload as object).length > 0;
  const isLarge = ev.eventType === 'COMFY_DISPATCH';

  const handleCopy = () => {
    void navigator.clipboard.writeText(JSON.stringify(ev.payload, null, 2)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div
      style={{
        borderBottom: '1px solid var(--border)',
        fontSize: 12,
      }}
    >
      <div
        style={{
          padding: '8px 18px',
          display: 'flex',
          gap: 12,
          alignItems: 'center',
        }}
      >
        <span className="mono" style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>
          {new Date(ev.createdAt).toLocaleTimeString()}
        </span>
        <span className="semi">{ev.eventType}</span>
        {hasPayload && !isLarge && (
          <span
            className="mono"
            style={{
              color: 'var(--muted)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {JSON.stringify(ev.payload as Record<string, unknown>)}
          </span>
        )}
        {hasPayload && isLarge && (
          <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
            <button
              className="btn sm ghost"
              style={{ fontSize: 11, padding: '2px 8px' }}
              onClick={handleCopy}
            >
              {copied ? '✓ Copied' : 'Copy'}
            </button>
            <button
              className="btn sm ghost"
              style={{ fontSize: 11, padding: '2px 8px' }}
              onClick={() => setOpen((v) => !v)}
            >
              {open ? 'Hide' : 'View'}
            </button>
          </div>
        )}
      </div>
      {isLarge && open && (
        <div style={{ padding: '0 18px 12px' }}>
          <pre
            style={{
              margin: 0,
              fontSize: 11,
              fontFamily: 'monospace',
              background: 'var(--bg-2)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '10px 12px',
              maxHeight: 480,
              overflowY: 'auto',
              overflowX: 'auto',
              whiteSpace: 'pre',
              color: 'var(--text)',
            }}
          >
            {JSON.stringify(ev.payload, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

interface Props {
  onNav: (_page: string, _filter?: { page: string; filter?: string }) => void;
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
}

import { useLocation } from 'react-router-dom';

export default function JobsPage({ onNav: _onNav, toast }: Props) {
  const location = useLocation();
  const requestedJobId = (location.state as { jobId?: string })?.jobId;
  const [filter, setFilter] = useState<FilterKey>(
    (location.state as { filter?: FilterKey })?.filter || 'all',
  );
  const [dateFilter, setDateFilter] = useState<string | null>(
    (location.state as { date?: string })?.date || null,
  );
  const [query, setQuery] = useState((location.state as { search?: string })?.search || '');
  const [jobTypeFilter, setJobTypeFilter] = useState<string>('');
  const [workerFilter, setWorkerFilter] = useState<string>('');
  const [createdFrom, setCreatedFrom] = useState<string>('');
  const [createdTo, setCreatedTo] = useState<string>('');
  const [jobTypeOptions, setJobTypeOptions] = useState<string[]>([]);
  const [workerOptions, setWorkerOptions] = useState<{ id: string; label: string }[]>([]);
  const [page, setPage] = useState(0);
  const [jumpToPage, setJumpToPage] = useState('');
  const [sortKey, setSortKey] = useState<keyof Job>('createdAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);
  const [actioning, setActioning] = useState(false);
  const [confirmFlush, setConfirmFlush] = useState(false);
  const [flushing, setFlushing] = useState(false);
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const [isNavOpen, setIsNavOpen] = useState(false);
  const [expandedSubTabsMap, setExpandedSubTabsMap] = useState<
    Record<string, 'input' | 'output' | 'events' | null>
  >({});
  const [jobDetailsMap, setJobDetailsMap] = useState<Record<string, JobDetail>>({});
  const [exportingXlsx, setExportingXlsx] = useState(false);

  const toggleMobileJobExpand = async (j: Job) => {
    const willExpand = expandedJobId !== j.id;
    setExpandedJobId(willExpand ? j.id : null);
    if (willExpand && !jobDetailsMap[j.id]) {
      try {
        const full = await apiFetch<JobDetail>(`/admin/jobs/${j.id}`);
        setJobDetailsMap((prev) => ({ ...prev, [j.id]: full }));
      } catch {
        // Ignore background fetch failure
      }
    }
  };

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const params = new URLSearchParams({ page: String(page + 1), pageSize: String(PAGE_SIZE) });
        if (filter !== 'all') params.set('status', filter);
        if (dateFilter) params.set('date', dateFilter);
        if (query) params.set('search', query);
        if (jobTypeFilter) params.set('jobType', jobTypeFilter);
        if (workerFilter) params.set('workerId', workerFilter);
        if (createdFrom) params.set('createdFrom', createdFrom);
        if (createdTo) params.set('createdTo', createdTo);
        const data = await apiFetch<{ items: Job[]; total: number }>(`/admin/jobs?${params}`);
        setJobs(data.items);
        setTotal(data.total);
      } catch (e) {
        if (!silent)
          toast({
            kind: 'error',
            title: 'Failed to load jobs',
            body: apiErrorMessage(e, 'Please try again.'),
          });
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [page, filter, dateFilter, query, jobTypeFilter, workerFilter, createdFrom, createdTo, toast],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!requestedJobId) return;
    let cancelled = false;
    setDetailLoading(true);
    apiFetch<JobDetail>(`/admin/jobs/${requestedJobId}`)
      .then((job) => {
        if (!cancelled) setDetail(job);
      })
      .catch((e) => {
        if (!cancelled)
          toast({
            kind: 'error',
            title: 'Failed to load job detail',
            body: apiErrorMessage(e, 'Please try again.'),
          });
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [requestedJobId, toast]);

  // Filter dropdown options — fetched once, not tied to the jobs list itself.
  useEffect(() => {
    apiFetch<string[]>('/admin/jobs/sources')
      .then(setJobTypeOptions)
      .catch(() => {
        // Non-fatal — the job type filter dropdown just stays empty.
      });
    apiFetch<{ id: string; label: string }[]>('/admin/workers')
      .then((workers) => setWorkerOptions(workers.map((w) => ({ id: w.id, label: w.label }))))
      .catch(() => {
        // Non-fatal — the worker filter dropdown just stays empty.
      });
  }, []);

  const flushQueue = useCallback(async () => {
    setFlushing(true);
    try {
      const res = await apiFetch<{ flushed: number }>('/admin/jobs/flush-queue', {
        method: 'POST',
      });
      toast({
        title: `Flushed ${res.flushed} queued job${res.flushed !== 1 ? 's' : ''} and refunded credits`,
      });
      void load();
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Flush failed',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    } finally {
      setFlushing(false);
      setConfirmFlush(false);
    }
  }, [load, toast]);

  useAdminJobStream(
    useCallback((evt) => {
      const status = evt.status as Job['status'];
      setJobs((prev) => prev.map((j) => (j.id === evt.jobId ? { ...j, status } : j)));
      setDetail((d) => (d?.id === evt.jobId ? { ...d, status } : d));
    }, []),
  );

  // Polling fallback when active jobs exist — catches updates if SSE drops (proxy buffering etc.)
  const hasActiveJobs = jobs.some((j) =>
    ['QUEUED', 'PREPROCESSING', 'GENERATING', 'UPLOADING'].includes(j.status),
  );
  useEffect(() => {
    if (!hasActiveJobs) return;
    const id = setInterval(() => void load(true), 5_000);
    return () => clearInterval(id);
  }, [hasActiveJobs, load]);

  const handleFilter = (k: FilterKey) => {
    setFilter(k);
    setPage(0);
  };
  const handleSearch = (q: string) => {
    setQuery(q);
    setPage(0);
  };
  const handleJobTypeFilter = (v: string) => {
    setJobTypeFilter(v);
    setPage(0);
  };
  const handleWorkerFilter = (v: string) => {
    setWorkerFilter(v);
    setPage(0);
  };
  const handleCreatedFrom = (v: string) => {
    setCreatedFrom(v);
    setPage(0);
  };
  const handleCreatedTo = (v: string) => {
    setCreatedTo(v);
    setPage(0);
  };
  const handleExportXlsx = async () => {
    setExportingXlsx(true);
    try {
      const params = new URLSearchParams();
      if (filter !== 'all') params.set('status', filter);
      if (dateFilter) params.set('date', dateFilter);
      if (query) params.set('search', query);
      if (jobTypeFilter) params.set('jobType', jobTypeFilter);
      if (workerFilter) params.set('workerId', workerFilter);
      if (createdFrom) params.set('createdFrom', createdFrom);
      if (createdTo) params.set('createdTo', createdTo);
      const blob = await apiFetchBlob(`/admin/jobs/export.xlsx?${params}`);
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.download = `jobs-export-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(href);
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to export jobs',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    } finally {
      setExportingXlsx(false);
    }
  };
  const hasExtraFilters = !!(jobTypeFilter || workerFilter || createdFrom || createdTo);
  const clearExtraFilters = () => {
    setJobTypeFilter('');
    setWorkerFilter('');
    setCreatedFrom('');
    setCreatedTo('');
    setPage(0);
  };

  const sorted = [...jobs].sort((a, b) => {
    const aVal = a[sortKey] ?? '';
    const bVal = b[sortKey] ?? '';
    let cmp: number;
    if (typeof aVal === 'boolean') cmp = Number(bVal as boolean) - Number(aVal);
    else if (typeof aVal === 'string') cmp = aVal.localeCompare(bVal as string);
    else cmp = (aVal as number) - (bVal as number);
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const handleJumpToPage = () => {
    const n = Number.parseInt(jumpToPage, 10);
    if (!Number.isNaN(n) && n >= 1 && n <= Math.max(1, totalPages)) {
      setPage(n - 1);
    }
    setJumpToPage('');
  };

  const handleSort = (k: keyof Job) => {
    if (k === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(k);
      setSortDir('desc');
    }
  };

  const openDetail = async (j: Job) => {
    setDetail(j);
    setDetailLoading(false);
    try {
      const full = await apiFetch<JobDetail>(`/admin/jobs/${j.id}`);
      setDetail(full);
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to load full job detail',
        body: apiErrorMessage(e, 'Displaying cached job info.'),
      });
    }
  };

  const handleCancel = async () => {
    if (!confirmCancel) return;
    setActioning(true);
    try {
      await apiFetch(`/admin/jobs/${confirmCancel}/cancel`, { method: 'POST' });
      toast({ title: `Job cancelled` });
      setConfirmCancel(null);
      if (detail?.id === confirmCancel) setDetail((d) => (d ? { ...d, status: 'CANCELLED' } : d));
      setJobs((prev) =>
        prev.map((j) => (j.id === confirmCancel ? { ...j, status: 'CANCELLED' } : j)),
      );
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Cancel failed',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    } finally {
      setActioning(false);
    }
  };

  const handleRetry = async (id: string) => {
    setActioning(true);
    try {
      await apiFetch(`/admin/jobs/${id}/retry`, { method: 'POST' });
      toast({ title: 'Job re-queued' });
      if (detail?.id === id)
        setDetail((d) => (d ? { ...d, status: 'QUEUED', errorCode: undefined } : d));
      setJobs((prev) =>
        prev.map((j) => (j.id === id ? { ...j, status: 'QUEUED', errorCode: undefined } : j)),
      );
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Retry failed',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    } finally {
      setActioning(false);
    }
  };

  const fmtDuration = (j: Job) => {
    if (!j.startedAt || !j.completedAt) return null;
    const ms = new Date(j.completedAt).getTime() - new Date(j.startedAt).getTime();
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const fmtTs = (ts?: string | null) => (ts ? new Date(ts).toLocaleString() : '—');

  if (detail) {
    const j = detail;
    return (
      <>
        <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
        <div className="page-head">
          <div>
            <button className="btn ghost" onClick={() => setDetail(null)}>
              <Icon.Back /> Back to jobs
            </button>
            <h1
              style={{
                marginTop: 8,
                fontFamily: 'var(--mono)',
                fontSize: 18,
                wordBreak: 'break-all',
                overflowWrap: 'anywhere',
              }}
            >
              {j.id}
            </h1>
            <p className="lede">
              {j.userEmail ?? j.userId} &middot; Created {fmtTs(j.createdAt)}
            </p>
          </div>
          <div className="head-tools">
            <button
              className="btn sm ghost"
              onClick={() => void openDetail(j)}
              disabled={detailLoading}
              title="Refresh"
              style={{ display: 'flex', alignItems: 'center', gap: 4 }}
            >
              <span
                style={{
                  display: 'inline-block',
                  animation: detailLoading ? 'spin 0.8s linear infinite' : 'none',
                }}
              >
                <Icon.Refresh />
              </span>
              Refresh
            </button>
            <StatusBadge status={j.status} />
            {(j.status === 'QUEUED' ||
              j.status === 'GENERATING' ||
              j.status === 'PREPROCESSING') && (
              <button
                className="btn danger"
                disabled={actioning}
                onClick={() => setConfirmCancel(j.id)}
              >
                <Icon.Ban /> Cancel
              </button>
            )}
            {j.status === 'FAILED' && (
              <button className="btn" disabled={actioning} onClick={() => handleRetry(j.id)}>
                <Icon.Refresh /> Retry
              </button>
            )}
          </div>
        </div>

        {detailLoading ? (
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>Loading&hellip;</p>
        ) : (
          <>
            <div className="kv-grid-2-col" style={{ marginBottom: 20 }}>
              <KV k="User" v={j.userEmail ?? '—'} />
              <KV k="Job Type" v={<JobTypeBadge jobType={j.jobType} />} />
              <KV k="Status" v={<StatusBadge status={j.status} />} />
              <KV k="Credits charged" v={String(j.creditsCharged)} />
              <KV k="Priority" v={j.priority ? 'Priority' : 'Normal'} />
              <KV k="Face" v={j.faceLabel ?? '—'} />
              <KV k="Background" v={j.backgroundLabel ?? '—'} />
              <KV k="Pose" v={j.poseLabel ?? '—'} />
              <KV k="Workflow" v={j.workflowLabel ?? '—'} />
              <KV k="Worker" v={j.workerId ?? '—'} />
              <KV k="Created" v={fmtTs(j.createdAt)} />
              <KV k="Started" v={fmtTs(j.startedAt)} />
              <KV k="Completed" v={fmtTs(j.completedAt)} />
              <KV k="Duration" v={fmtDuration(j) ?? '—'} />
              {j.attempts != null && <KV k="Attempts" v={String(j.attempts)} />}
              {j.errorCode && <KV k="Error code" v={j.errorCode} />}
            </div>

            {j.outputUrl && (
              <div className="card" style={{ marginBottom: 14 }}>
                <div className="card-head">
                  <h3>Output</h3>
                </div>
                <div className="card-body">
                  <a href={j.outputUrl} target="_blank" rel="noreferrer" className="link">
                    View output <Icon.ExternalLink />
                  </a>
                </div>
              </div>
            )}

            {j.inputImages && Object.values(j.inputImages).some(Boolean) && (
              <div className="card" style={{ marginBottom: 14 }}>
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
                      ] as { key: keyof InputImages; label: string }[]
                    ).map(({ key, label }) => {
                      const url = j.inputImages?.[key];
                      if (!url) return null;
                      return (
                        <a
                          key={key}
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          style={{ textDecoration: 'none', textAlign: 'center' }}
                        >
                          {/* biome-ignore lint/performance/noImgElement: admin SPA, not Next.js */}
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
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {j.userHint && (
              <div className="card" style={{ marginBottom: 14 }}>
                <div className="card-head">
                  <h3>User hint</h3>
                </div>
                <div className="card-body">
                  <p style={{ margin: 0, fontFamily: 'var(--mono)', fontSize: 13 }}>{j.userHint}</p>
                </div>
              </div>
            )}

            {j.errorCode && (
              <div className="card" style={{ marginBottom: 14 }}>
                <div className="card-head">
                  <h3>Error</h3>
                </div>
                <div className="card-body">
                  <div className="banner error">
                    <div className="ic">
                      <Icon.Alert />
                    </div>
                    <div>
                      <b>Error code</b>
                      <p
                        style={{ margin: 0, fontSize: 13, marginTop: 2, fontFamily: 'var(--mono)' }}
                      >
                        {j.errorCode}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {j.events && j.events.length > 0 && (
              <div className="card">
                <div className="card-head">
                  <h3>Events</h3>
                </div>
                <div className="card-body" style={{ padding: 0 }}>
                  {j.events.map((ev) => (
                    <EventRow key={ev.id} ev={ev} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {confirmCancel && (
          <div className="modal-overlay" onClick={() => setConfirmCancel(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-head">
                <h3>Cancel job</h3>
              </div>
              <div className="modal-body">
                <p>
                  Cancel job <strong>{confirmCancel}</strong>? Credits will be refunded.
                </p>
              </div>
              <div className="modal-foot">
                <button
                  className="btn ghost"
                  onClick={() => setConfirmCancel(null)}
                  disabled={actioning}
                >
                  Back
                </button>
                <button className="btn danger" onClick={handleCancel} disabled={actioning}>
                  <Icon.Ban /> Yes, cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
      {/* Desktop header & tools */}
      <div className="desktop-only">
        <div className="page-head">
          <div>
            <h1>Jobs</h1>
            <p className="lede">
              {loading ? '…' : total.toLocaleString()} jobs &middot; Monitor and manage try-on jobs.
            </p>
          </div>
          <div className="head-tools">
            <div className="search">
              <Icon.Search />
              <input
                placeholder="Search by job ID or user email…"
                value={query}
                onChange={(e) => handleSearch(e.target.value)}
              />
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span
                className="sub"
                style={{ fontSize: 13, whiteSpace: 'nowrap', color: 'var(--muted)' }}
              >
                Sort by:
              </span>
              <select
                value={`${sortKey}-${sortDir}`}
                onChange={(e) => {
                  const [key, dir] = e.target.value.split('-');
                  setSortKey(key as keyof Job);
                  setSortDir(dir as SortDir);
                }}
                style={{
                  padding: '6px 12px',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'var(--surface)',
                  color: 'var(--ink)',
                  fontSize: 13,
                  cursor: 'pointer',
                  outline: 'none',
                }}
              >
                <option value="createdAt-desc">Newest Created</option>
                <option value="createdAt-asc">Oldest Created</option>
                <option value="userEmail-asc">User Email (A-Z)</option>
                <option value="userEmail-desc">User Email (Z-A)</option>
                <option value="creditsCharged-desc">Credits (High-Low)</option>
                <option value="creditsCharged-asc">Credits (Low-High)</option>
                <option value="status-asc">Status</option>
              </select>
            </div>

            {confirmFlush ? (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>Cancel all queued jobs?</span>
                <button
                  className="btn sm danger"
                  onClick={() => void flushQueue()}
                  disabled={flushing}
                >
                  {flushing ? 'Flushing…' : 'Confirm'}
                </button>
                <button className="btn sm ghost" onClick={() => setConfirmFlush(false)}>
                  No
                </button>
              </div>
            ) : (
              <button className="btn sm ghost" onClick={() => setConfirmFlush(true)}>
                Flush queue
              </button>
            )}
            <button
              className="btn sm ghost"
              onClick={() => void handleExportXlsx()}
              disabled={exportingXlsx}
            >
              <Icon.Download /> {exportingXlsx ? 'Exporting…' : 'Download Excel'}
            </button>
            <button
              className="btn sm ghost"
              onClick={() => void load()}
              disabled={loading}
              title="Refresh"
              style={{ display: 'flex', alignItems: 'center', gap: 4 }}
            >
              <span
                style={{
                  display: 'inline-block',
                  animation: loading ? 'spin 0.8s linear infinite' : 'none',
                }}
              >
                <Icon.Refresh />
              </span>
              Refresh
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div className="tabs" style={{ marginBottom: 0 }}>
            {FILTERS.map((f) => (
              <button
                key={f.k}
                className={`tab ${filter === f.k ? 'active' : ''}`}
                onClick={() => handleFilter(f.k)}
              >
                {f.l}
              </button>
            ))}
          </div>
          {dateFilter && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                className="badge"
                style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
              >
                Date: {dateFilter}
              </span>
              <button
                className="btn sm ghost"
                onClick={() => {
                  setDateFilter(null);
                  setPage(0);
                }}
                style={{ padding: '4px 8px' }}
              >
                Clear
              </button>
            </div>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginBottom: 16,
            flexWrap: 'wrap',
          }}
        >
          <select
            value={jobTypeFilter}
            onChange={(e) => handleJobTypeFilter(e.target.value)}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--ink)',
              fontSize: 13,
              cursor: 'pointer',
              outline: 'none',
            }}
          >
            <option value="">All Job Types</option>
            {jobTypeOptions.map((jt) => (
              <option key={jt} value={jt}>
                {jt}
              </option>
            ))}
          </select>

          <select
            value={workerFilter}
            onChange={(e) => handleWorkerFilter(e.target.value)}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--ink)',
              fontSize: 13,
              cursor: 'pointer',
              outline: 'none',
            }}
          >
            <option value="">All Workers</option>
            {workerOptions.map((w) => (
              <option key={w.id} value={w.id}>
                {w.label || w.id}
              </option>
            ))}
          </select>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="sub" style={{ fontSize: 13, color: 'var(--muted)' }}>
              Created:
            </span>
            <input
              type="datetime-local"
              value={createdFrom}
              onChange={(e) => handleCreatedFrom(e.target.value)}
              style={{
                padding: '5px 8px',
                borderRadius: 6,
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                color: 'var(--ink)',
                fontSize: 13,
              }}
            />
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>to</span>
            <input
              type="datetime-local"
              value={createdTo}
              onChange={(e) => handleCreatedTo(e.target.value)}
              style={{
                padding: '5px 8px',
                borderRadius: 6,
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                color: 'var(--ink)',
                fontSize: 13,
              }}
            />
            <span className="sub" style={{ fontSize: 12, color: 'var(--muted)' }}>
              (applies to Download Excel)
            </span>
          </div>

          {hasExtraFilters && (
            <button className="btn sm ghost" onClick={clearExtraFilters}>
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Mobile/Tablet single vertical bar header */}
      <div className="mobile-only" style={{ marginBottom: 20 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 12,
          }}
        >
          <h1 style={{ margin: 0 }}>Jobs</h1>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn sm ghost"
              onClick={() => void handleExportXlsx()}
              disabled={exportingXlsx}
              title="Download Excel"
              style={{ display: 'flex', alignItems: 'center', gap: 4 }}
            >
              <Icon.Download />
            </button>
            <button
              className="btn sm ghost"
              onClick={() => void load()}
              disabled={loading}
              title="Refresh"
              style={{ display: 'flex', alignItems: 'center', gap: 4 }}
            >
              <span
                style={{
                  display: 'inline-block',
                  animation: loading ? 'spin 0.8s linear infinite' : 'none',
                }}
              >
                <Icon.Refresh />
              </span>
              Refresh
            </button>
          </div>
        </div>

        <div style={{ position: 'relative' }}>
          <button
            type="button"
            onClick={() => setIsNavOpen(!isNavOpen)}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 20px',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              cursor: 'pointer',
              textAlign: 'left',
              color: 'var(--ink)',
              fontSize: 15,
              fontWeight: 600,
              boxShadow: 'var(--shadow-sm)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span
                style={{
                  display: 'inline-block',
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: 'var(--accent)',
                }}
              />
              Jobs — {FILTERS.find((f) => f.k === filter)?.l || 'All'}
            </div>
            <span
              style={{
                color: 'var(--muted-2)',
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
                style={{
                  position: 'fixed',
                  inset: 0,
                  zIndex: 99,
                  background: 'transparent',
                }}
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
                  padding: '12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                  maxHeight: '400px',
                  overflowY: 'auto',
                }}
              >
                {/* Search input starting with Search */}
                <div className="search" style={{ width: '100%' }}>
                  <Icon.Search />
                  <input
                    placeholder="Search jobs..."
                    value={query}
                    onChange={(e) => handleSearch(e.target.value)}
                  />
                </div>

                {/* Sort dropdown */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span className="sub" style={{ fontSize: 12, color: 'var(--muted)' }}>
                    Sort by:
                  </span>
                  <select
                    value={`${sortKey}-${sortDir}`}
                    onChange={(e) => {
                      const [key, dir] = e.target.value.split('-');
                      setSortKey(key as keyof Job);
                      setSortDir(dir as SortDir);
                    }}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: 6,
                      border: '1px solid var(--border)',
                      background: 'var(--bg-2)',
                      color: 'var(--ink)',
                      fontSize: 13,
                    }}
                  >
                    <option value="createdAt-desc">Newest Created</option>
                    <option value="createdAt-asc">Oldest Created</option>
                    <option value="userEmail-asc">User Email (A-Z)</option>
                    <option value="userEmail-desc">User Email (Z-A)</option>
                    <option value="creditsCharged-desc">Credits (High-Low)</option>
                    <option value="creditsCharged-asc">Credits (Low-High)</option>
                    <option value="status-asc">Status</option>
                  </select>
                </div>

                {/* Filter options one by one */}
                <div
                  style={{
                    borderTop: '1px solid var(--border)',
                    paddingTop: 8,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                  }}
                >
                  <span
                    className="sub"
                    style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}
                  >
                    Filter Status:
                  </span>
                  {FILTERS.map((f) => (
                    <button
                      key={f.k}
                      type="button"
                      onClick={() => {
                        handleFilter(f.k);
                        setIsNavOpen(false);
                      }}
                      style={{
                        width: '100%',
                        padding: '10px 14px',
                        background: filter === f.k ? 'var(--bg-2)' : 'none',
                        border: 'none',
                        borderRadius: 6,
                        textAlign: 'left',
                        cursor: 'pointer',
                        fontSize: 14,
                        fontWeight: filter === f.k ? 600 : 400,
                        color: filter === f.k ? 'var(--accent)' : 'var(--ink)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                      }}
                    >
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          background: filter === f.k ? 'var(--accent)' : 'transparent',
                          display: 'inline-block',
                        }}
                      />
                      {f.l}
                    </button>
                  ))}
                </div>

                {/* Job type / worker / created-at range */}
                <div
                  style={{
                    borderTop: '1px solid var(--border)',
                    paddingTop: 8,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <span className="sub" style={{ fontSize: 12, color: 'var(--muted)' }}>
                    Job Type:
                  </span>
                  <select
                    value={jobTypeFilter}
                    onChange={(e) => handleJobTypeFilter(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: 6,
                      border: '1px solid var(--border)',
                      background: 'var(--bg-2)',
                      color: 'var(--ink)',
                      fontSize: 13,
                    }}
                  >
                    <option value="">All Job Types</option>
                    {jobTypeOptions.map((jt) => (
                      <option key={jt} value={jt}>
                        {jt}
                      </option>
                    ))}
                  </select>

                  <span className="sub" style={{ fontSize: 12, color: 'var(--muted)' }}>
                    Worker:
                  </span>
                  <select
                    value={workerFilter}
                    onChange={(e) => handleWorkerFilter(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: 6,
                      border: '1px solid var(--border)',
                      background: 'var(--bg-2)',
                      color: 'var(--ink)',
                      fontSize: 13,
                    }}
                  >
                    <option value="">All Workers</option>
                    {workerOptions.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.label || w.id}
                      </option>
                    ))}
                  </select>

                  <span className="sub" style={{ fontSize: 12, color: 'var(--muted)' }}>
                    Created from:
                  </span>
                  <input
                    type="datetime-local"
                    value={createdFrom}
                    onChange={(e) => handleCreatedFrom(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: 6,
                      border: '1px solid var(--border)',
                      background: 'var(--bg-2)',
                      color: 'var(--ink)',
                      fontSize: 13,
                    }}
                  />

                  <span className="sub" style={{ fontSize: 12, color: 'var(--muted)' }}>
                    Created to:
                  </span>
                  <input
                    type="datetime-local"
                    value={createdTo}
                    onChange={(e) => handleCreatedTo(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: 6,
                      border: '1px solid var(--border)',
                      background: 'var(--bg-2)',
                      color: 'var(--ink)',
                      fontSize: 13,
                    }}
                  />
                  <span className="sub" style={{ fontSize: 11, color: 'var(--muted)' }}>
                    Applies to Download Excel too
                  </span>

                  {hasExtraFilters && (
                    <button
                      type="button"
                      className="btn sm ghost"
                      onClick={clearExtraFilters}
                      style={{ width: '100%' }}
                    >
                      Clear filters
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {loading ? (
        <p style={{ color: 'var(--muted)', fontSize: 13, padding: '20px 0' }}>Loading&hellip;</p>
      ) : (
        <>
          <div className="desktop-only table-wrap">
            <table>
              <thead>
                <tr>
                  <Th k="id" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>
                    Job ID
                  </Th>
                  <Th k="userEmail" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>
                    User
                  </Th>
                  <Th k="jobType" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>
                    Job Type
                  </Th>
                  <Th k="status" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>
                    Status
                  </Th>
                  <Th k="creditsCharged" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>
                    Credits
                  </Th>
                  <Th k="workerId" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>
                    Worker
                  </Th>
                  <Th k="createdAt" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>
                    Created
                  </Th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((j) => (
                  <tr key={j.id} onClick={() => void openDetail(j)} style={{ cursor: 'pointer' }}>
                    <td>
                      <span className="mono sub" style={{ fontSize: 11 }}>
                        {j.id.slice(0, 8)}…
                      </span>
                    </td>
                    <td>
                      <span className="semi">{j.userEmail ?? '—'}</span>
                    </td>
                    <td>
                      <JobTypeBadge jobType={j.jobType} />
                    </td>
                    <td>
                      <StatusBadge status={j.status} />
                    </td>
                    <td>
                      <span className="mono">{j.creditsCharged}</span>
                    </td>
                    <td>
                      <span className="mono sub" style={{ fontSize: 11 }}>
                        {j.workerId ?? '—'}
                      </span>
                    </td>
                    <td>
                      <span className="mono sub" style={{ fontSize: 11 }}>
                        {new Date(j.createdAt).toLocaleString()}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {(j.status === 'QUEUED' ||
                          j.status === 'GENERATING' ||
                          j.status === 'PREPROCESSING') && (
                          <button
                            className="btn sm ghost"
                            title="Cancel"
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmCancel(j.id);
                            }}
                          >
                            <Icon.Ban />
                          </button>
                        )}
                        {j.status === 'FAILED' && (
                          <button
                            className="btn sm ghost"
                            title="Retry"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleRetry(j.id);
                            }}
                          >
                            <Icon.Refresh />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {sorted.length === 0 && (
                  <tr>
                    <td
                      colSpan={9}
                      style={{ textAlign: 'center', color: 'var(--muted)', padding: '2rem' }}
                    >
                      No jobs found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mobile-only" style={{ gap: 12 }}>
            {sorted.map((j) => {
              const isExpanded = expandedJobId === j.id;
              const fullJ =
                (jobDetailsMap[j.id] as JobDetail | undefined) ?? (j as unknown as JobDetail);
              const activeSubTab = expandedSubTabsMap[j.id] ?? null;

              return (
                <div
                  key={j.id}
                  className="card"
                  style={{
                    padding: 0,
                    overflow: 'hidden',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    background: 'var(--surface)',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => void toggleMobileJobExpand(j)}
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
                            fontSize: 14,
                            color: 'var(--ink)',
                            fontWeight: 600,
                          }}
                        >
                          {j.userEmail ?? 'No user email'}
                        </div>
                        <div
                          className="sub"
                          style={{ fontSize: 11, marginTop: 2, color: 'var(--muted)' }}
                        >
                          Created {fmtTs(j.createdAt)}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 8 }}>
                      <StatusBadge status={j.status} />
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
                      {/* 1. Job details */}
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
                          Job Details
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                          }}
                        >
                          <span style={{ color: 'var(--muted)' }}>Job ID</span>
                          <span className="mono sub" style={{ fontSize: 11 }}>
                            {j.id}
                          </span>
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                          }}
                        >
                          <span style={{ color: 'var(--muted)' }}>User Mail</span>
                          <span className="semi">{j.userEmail ?? '—'}</span>
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                          }}
                        >
                          <span style={{ color: 'var(--muted)' }}>Job Type</span>
                          <JobTypeBadge jobType={j.jobType} />
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                          }}
                        >
                          <span style={{ color: 'var(--muted)' }}>Status</span>
                          <StatusBadge status={j.status} />
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                          }}
                        >
                          <span style={{ color: 'var(--muted)' }}>Workflow</span>
                          <span className="mono sub" style={{ fontSize: 11 }}>
                            {fullJ.workflowLabel ?? 'tryon_v2_full'}
                          </span>
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                          }}
                        >
                          <span style={{ color: 'var(--muted)' }}>Created</span>
                          <span className="sub">{fmtTs(j.createdAt)}</span>
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                          }}
                        >
                          <span style={{ color: 'var(--muted)' }}>Started</span>
                          <span className="sub">{fmtTs(j.startedAt)}</span>
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                          }}
                        >
                          <span style={{ color: 'var(--muted)' }}>Completed</span>
                          <span className="sub">{fmtTs(j.completedAt)}</span>
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                          }}
                        >
                          <span style={{ color: 'var(--muted)' }}>Duration</span>
                          <span className="mono sub">{fmtDuration(j) ?? '—'}</span>
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                          }}
                        >
                          <span style={{ color: 'var(--muted)' }}>Attempts</span>
                          <span className="mono sub">{j.attempts ?? 1}</span>
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                          }}
                        >
                          <span style={{ color: 'var(--muted)' }}>Credits Charged</span>
                          <span className="mono bold">{j.creditsCharged}</span>
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                          }}
                        >
                          <span style={{ color: 'var(--muted)' }}>Worker</span>
                          <span className="mono sub">{j.workerId ?? '—'}</span>
                        </div>
                      </div>

                      {/* Sub-navigation buttons for Input, Output, Events */}
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button
                          className={`btn sm ${activeSubTab === 'input' ? 'primary' : 'ghost'}`}
                          onClick={() =>
                            setExpandedSubTabsMap((prev) => ({
                              ...prev,
                              [j.id]: prev[j.id] === 'input' ? null : 'input',
                            }))
                          }
                          style={{ flex: 1, justifyContent: 'center' }}
                        >
                          Input Uploads
                        </button>
                        <button
                          className={`btn sm ${activeSubTab === 'output' ? 'primary' : 'ghost'}`}
                          onClick={() =>
                            setExpandedSubTabsMap((prev) => ({
                              ...prev,
                              [j.id]: prev[j.id] === 'output' ? null : 'output',
                            }))
                          }
                          style={{ flex: 1, justifyContent: 'center' }}
                        >
                          Output Result
                        </button>
                        <button
                          className={`btn sm ${activeSubTab === 'events' ? 'primary' : 'ghost'}`}
                          onClick={() =>
                            setExpandedSubTabsMap((prev) => ({
                              ...prev,
                              [j.id]: prev[j.id] === 'events' ? null : 'events',
                            }))
                          }
                          style={{ flex: 1, justifyContent: 'center' }}
                        >
                          Events
                        </button>
                      </div>

                      {/* 2. Input Section */}
                      {activeSubTab === 'input' && (
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
                            Uploaded Input Files (Original-Upper-Lower-Shoes-Background-Pose)
                          </div>
                          <div
                            style={{
                              display: 'grid',
                              gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))',
                              gap: 10,
                            }}
                          >
                            {(
                              [
                                { key: 'person', label: 'Original' },
                                { key: 'upper', label: 'Upper' },
                                { key: 'lower', label: 'Lower' },
                                { key: 'shoe', label: 'Shoes' },
                                { key: 'background', label: 'Background' },
                                { key: 'pose', label: 'Pose' },
                              ] as { key: keyof InputImages; label: string }[]
                            ).map(({ key, label }) => {
                              const url = fullJ.inputImages?.[key];
                              if (!url) return null;
                              return (
                                <a
                                  key={key}
                                  href={url}
                                  target="_blank"
                                  rel="noreferrer"
                                  style={{ textDecoration: 'none', textAlign: 'center' }}
                                >
                                  <img
                                    src={url}
                                    alt={label}
                                    style={{
                                      width: '100%',
                                      aspectRatio: '1/1',
                                      objectFit: 'cover',
                                      borderRadius: 6,
                                      border: '1px solid var(--border)',
                                      display: 'block',
                                    }}
                                  />
                                  <span
                                    style={{
                                      fontSize: 10,
                                      color: 'var(--muted)',
                                      marginTop: 4,
                                      display: 'block',
                                    }}
                                  >
                                    {label}
                                  </span>
                                </a>
                              );
                            })}
                          </div>
                          {(!fullJ.inputImages ||
                            !Object.values(fullJ.inputImages).some(Boolean)) && (
                            <span className="sub" style={{ fontSize: 12, color: 'var(--muted)' }}>
                              No uploaded input images for this job.
                            </span>
                          )}
                        </div>
                      )}

                      {/* 3. Output Section */}
                      {activeSubTab === 'output' && (
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
                            Output Result
                          </div>
                          {fullJ.outputUrl ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                              <img
                                src={fullJ.outputUrl}
                                alt="Output"
                                style={{
                                  width: '100%',
                                  maxHeight: 240,
                                  objectFit: 'contain',
                                  borderRadius: 6,
                                  border: '1px solid var(--border)',
                                  background: 'var(--bg)',
                                }}
                              />
                              <a
                                href={fullJ.outputUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="btn sm ghost"
                                style={{ justifyContent: 'center' }}
                              >
                                Open full output <Icon.ExternalLink />
                              </a>
                            </div>
                          ) : (
                            <span className="sub" style={{ fontSize: 12, color: 'var(--muted)' }}>
                              No output generated yet.
                            </span>
                          )}
                        </div>
                      )}

                      {/* 4. Events Section */}
                      {activeSubTab === 'events' && (
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
                            Job Events & Logs
                          </div>
                          {fullJ.events && fullJ.events.length > 0 ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                              {fullJ.events.map((ev) => (
                                <EventRow key={ev.id} ev={ev} />
                              ))}
                            </div>
                          ) : (
                            <span className="sub" style={{ fontSize: 12, color: 'var(--muted)' }}>
                              No execution events recorded.
                            </span>
                          )}
                        </div>
                      )}

                      {/* Action buttons (Cancel / Retry) */}
                      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                        {(j.status === 'QUEUED' ||
                          j.status === 'GENERATING' ||
                          j.status === 'PREPROCESSING') && (
                          <button
                            className="btn danger sm"
                            disabled={actioning}
                            onClick={() => setConfirmCancel(j.id)}
                            style={{ flex: 1, justifyContent: 'center' }}
                          >
                            <Icon.Ban /> Cancel Job
                          </button>
                        )}
                        {j.status === 'FAILED' && (
                          <button
                            className="btn primary sm"
                            disabled={actioning}
                            onClick={() => handleRetry(j.id)}
                            style={{ flex: 1, justifyContent: 'center' }}
                          >
                            <Icon.Refresh /> Retry Job
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {sorted.length === 0 && (
              <div
                style={{
                  textAlign: 'center',
                  color: 'var(--muted)',
                  padding: '3rem 1.5rem',
                  background: 'var(--surface)',
                  border: '1px dashed var(--border)',
                  borderRadius: 8,
                }}
              >
                No jobs found.
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

          {totalPages > 1 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                marginTop: 12,
              }}
            >
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>Jump to page:</span>
              <input
                type="number"
                min={1}
                max={totalPages}
                placeholder={`1-${totalPages}`}
                value={jumpToPage}
                onChange={(e) => setJumpToPage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleJumpToPage();
                }}
                style={{
                  width: 70,
                  padding: '5px 8px',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'var(--surface)',
                  color: 'var(--ink)',
                  fontSize: 13,
                }}
              />
              <button className="btn sm ghost" onClick={handleJumpToPage}>
                Go
              </button>
            </div>
          )}
        </>
      )}

      {confirmCancel && (
        <div className="modal-overlay" onClick={() => setConfirmCancel(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Cancel job</h3>
            </div>
            <div className="modal-body">
              <p>
                Cancel job <strong>{confirmCancel}</strong>? Credits will be refunded.
              </p>
            </div>
            <div className="modal-foot">
              <button
                className="btn ghost"
                onClick={() => setConfirmCancel(null)}
                disabled={actioning}
              >
                Back
              </button>
              <button className="btn danger" onClick={handleCancel} disabled={actioning}>
                <Icon.Ban /> Yes, cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
