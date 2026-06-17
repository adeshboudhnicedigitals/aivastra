import type { ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { Icon } from '../components/Icons';
import { Pager } from '../components/Pager';
import { StatusBadge } from '../components/StatusBadge';
import type { SortDir } from '../components/Th';
import { Th } from '../components/Th';
import { useAdminJobStream } from '../hooks/use-admin-job-stream';
import { apiFetch } from '../lib/data';
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

export default function JobsPage({ onNav: _onNav, toast }: Props) {
  const [filter, setFilter] = useState<FilterKey>('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [sortKey, setSortKey] = useState<keyof Job>('createdAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);
  const [actioning, setActioning] = useState(false);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const params = new URLSearchParams({ page: String(page + 1), pageSize: String(PAGE_SIZE) });
        if (filter !== 'all') params.set('status', filter);
        if (query) params.set('search', query);
        const data = await apiFetch<{ items: Job[]; total: number }>(`/admin/jobs?${params}`);
        setJobs(data.items);
        setTotal(data.total);
      } catch {
        if (!silent) toast({ kind: 'error', title: 'Failed to load jobs' });
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [page, filter, query, toast],
  );

  useEffect(() => {
    void load();
  }, [load]);

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

  const handleSort = (k: keyof Job) => {
    if (k === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(k);
      setSortDir('desc');
    }
  };

  const openDetail = async (j: Job) => {
    setDetail(j);
    setDetailLoading(true);
    try {
      const full = await apiFetch<JobDetail>(`/admin/jobs/${j.id}`);
      setDetail(full);
    } catch {
      toast({ kind: 'error', title: 'Failed to load job detail' });
    } finally {
      setDetailLoading(false);
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
    } catch {
      toast({ kind: 'error', title: 'Cancel failed' });
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
    } catch {
      toast({ kind: 'error', title: 'Retry failed' });
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
            <h1 style={{ marginTop: 8, fontFamily: 'var(--mono)', fontSize: 18 }}>{j.id}</h1>
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
            <div
              className="kv-grid"
              style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 20 }}
            >
              <KV k="User" v={j.userEmail ?? '—'} />
              <KV k="Status" v={<StatusBadge status={j.status} />} />
              <KV k="Credits charged" v={String(j.creditsCharged)} />
              <KV k="Priority" v={j.priority ? 'PRO' : 'Normal'} />
              <KV k="Face" v={j.faceLabel ?? '—'} />
              <KV k="Background" v={j.backgroundLabel ?? '—'} />
              <KV k="Pose" v={j.poseLabel ?? '—'} />
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

      <div className="tabs">
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

      {loading ? (
        <p style={{ color: 'var(--muted)', fontSize: 13, padding: '20px 0' }}>Loading&hellip;</p>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <Th k="id" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>
                    Job ID
                  </Th>
                  <Th k="userEmail" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>
                    User
                  </Th>
                  <Th k="faceLabel" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>
                    Face / Pose
                  </Th>
                  <th>Add-ons</th>
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
                  <tr key={j.id} onClick={() => openDetail(j)} style={{ cursor: 'pointer' }}>
                    <td>
                      <span className="mono sub" style={{ fontSize: 11 }}>
                        {j.id.slice(0, 8)}…
                      </span>
                    </td>
                    <td>
                      <span className="semi">{j.userEmail ?? '—'}</span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {j.faceThumbnailUrl && (
                          // biome-ignore lint/performance/noImgElement: admin SPA, not Next.js
                          <img
                            src={j.faceThumbnailUrl}
                            alt=""
                            style={{
                              width: 32,
                              height: 32,
                              objectFit: 'cover',
                              borderRadius: 4,
                              border: '1px solid var(--border)',
                              flexShrink: 0,
                            }}
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                            }}
                          />
                        )}
                        <div>
                          <span className="semi">{j.faceLabel ?? '—'}</span>
                          <span className="sub" style={{ display: 'block' }}>
                            {j.poseLabel ?? '—'}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {j.hasLower && <span className="badge dot accent">Lower</span>}
                        {j.hasShoe && <span className="badge dot warn">Shoe</span>}
                        {!j.hasLower && !j.hasShoe && <span className="sub">—</span>}
                      </div>
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
                              handleRetry(j.id);
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

          <Pager
            page={page}
            totalPages={totalPages}
            onPage={setPage}
            totalItems={total}
            pageSize={PAGE_SIZE}
          />
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

function KV({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="kv">
      <span className="kv-k">{k}</span>
      <span className="kv-v">{v}</span>
    </div>
  );
}
