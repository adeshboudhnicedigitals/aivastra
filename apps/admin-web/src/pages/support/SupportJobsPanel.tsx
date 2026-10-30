import { useCallback, useEffect, useState } from 'react';
import { Icon } from '../../components/Icons';
import { JobTypeBadge } from '../../components/JobTypeBadge';
import { KV } from '../../components/KV';
import { StatusBadge } from '../../components/StatusBadge';
import { apiErrorMessage, apiFetch } from '../../lib/data';
import type { Job, JobStatus } from '../../types';

// This panel mirrors JobsPage's design (page head, status-pill filter bar,
// search box, table layout, detail view) rather than inventing a new look —
// it calls the exact same admin job endpoints JobsPage does, nothing new.

const FILTERS = [
  { k: 'all', l: 'All' },
  { k: 'QUEUED', l: 'Queued' },
  { k: 'GENERATING', l: 'Generating' },
  { k: 'COMPLETED', l: 'Completed' },
  { k: 'FAILED', l: 'Failed' },
  { k: 'CANCELLED', l: 'Cancelled' },
] as const;

type FilterKey = 'all' | JobStatus;

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
  inputImages?: InputImages;
  workflowLabel?: string | null;
  regenerateReason?: string | null;
}

function jobContactEmail(j: Job): string | null {
  return j.userEmail ?? j.shopEmail ?? null;
}

function fmtDuration(j: Job) {
  if (!j.startedAt || !j.completedAt) return null;
  const ms = new Date(j.completedAt).getTime() - new Date(j.startedAt).getTime();
  return `${(ms / 1000).toFixed(1)}s`;
}

const fmtTs = (ts?: string | null) => (ts ? new Date(ts).toLocaleString() : '—');

interface Props {
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
  onNav: (_page: string) => void;
}

export default function SupportJobsPanel({ toast, onNav }: Props) {
  const [filter, setFilter] = useState<FilterKey>('all');
  const [query, setQuery] = useState('');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);
  const [actioning, setActioning] = useState(false);

  const load = useCallback(
    async (f: FilterKey, q: string, silent = false) => {
      if (!silent) setLoading(true);
      try {
        const params = new URLSearchParams({ page: '1', pageSize: '50' });
        if (f !== 'all') params.set('status', f);
        if (q) params.set('search', q);
        const data = await apiFetch<{ items: Job[]; total: number }>(
          `/admin/jobs?${params.toString()}`,
        );
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
    [toast],
  );

  // Debounced so typing in the search box doesn't fire a request per keystroke
  // (0ms when only the status filter changed, same intent as JobsPage's own
  // search box debounce).
  useEffect(() => {
    const id = setTimeout(() => void load(filter, query), query ? 400 : 0);
    return () => clearTimeout(id);
  }, [load, filter, query]);

  useEffect(() => {
    const poll = setInterval(() => void load(filter, query, true), 20_000);
    return () => clearInterval(poll);
  }, [load, filter, query]);

  const openDetail = async (j: Job) => {
    setDetail(j);
    setDetailLoading(true);
    try {
      const full = await apiFetch<JobDetail>(`/admin/jobs/${j.id}`);
      setDetail(full);
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to load full job detail',
        body: apiErrorMessage(e, 'Displaying cached job info.'),
      });
    } finally {
      setDetailLoading(false);
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

  const handleCancel = async () => {
    if (!confirmCancelId) return;
    setActioning(true);
    try {
      const response = await apiFetch<{ ok: boolean; pending?: boolean }>(
        `/admin/jobs/${confirmCancelId}/cancel`,
        { method: 'POST' },
      );
      if (response.pending === true) {
        toast({
          title: 'Cancellation requested',
          body: 'Waiting for the dispatcher to stop the job.',
        });
        setConfirmCancelId(null);
        return;
      }
      toast({ title: 'Job cancelled' });
      if (detail?.id === confirmCancelId) setDetail((d) => (d ? { ...d, status: 'CANCELLED' } : d));
      setJobs((prev) =>
        prev.map((j) => (j.id === confirmCancelId ? { ...j, status: 'CANCELLED' } : j)),
      );
      setConfirmCancelId(null);
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

  // ── Detail view ──────────────────────────────────────────────────────────
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
              {jobContactEmail(j) ?? j.userId} · Created {fmtTs(j.createdAt)}
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
                onClick={() => setConfirmCancelId(j.id)}
              >
                <Icon.Ban /> Cancel
              </button>
            )}
            {j.status === 'FAILED' && (
              <button className="btn" disabled={actioning} onClick={() => handleRetry(j.id)}>
                <Icon.Refresh /> Retry
              </button>
            )}
            <button
              className="btn ghost"
              onClick={() => onNav(`jobs?job=${encodeURIComponent(j.id)}`)}
            >
              <Icon.ExternalLink /> Open in Jobs
            </button>
          </div>
        </div>

        {detailLoading ? (
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>Loading…</p>
        ) : (
          <>
            <div className="kv-grid-2-col" style={{ marginBottom: 20 }}>
              <KV k="User" v={jobContactEmail(j) ?? '—'} />
              {j.shopDomain && <KV k="Shop" v={j.shopDomain} />}
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
              {j.parentJobId && (
                <KV
                  k="Origin"
                  v={
                    <span style={{ color: 'var(--warn, #b8860b)', fontWeight: 600 }}>
                      Regenerated
                    </span>
                  }
                />
              )}
              {j.parentJobId && <KV k="Regenerate reason" v={j.regenerateReason ?? '—'} />}
            </div>

            {((j.inputImages && Object.values(j.inputImages).some(Boolean)) || j.outputUrl) && (
              <div className="card" style={{ marginBottom: 14 }}>
                <div className="card-head">
                  <h3>Images</h3>
                </div>
                <div className="card-body">
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                    {(
                      [
                        { key: 'person', label: 'Person', url: j.inputImages?.person },
                        { key: 'face', label: 'Face', url: j.inputImages?.face },
                        { key: 'background', label: 'Background', url: j.inputImages?.background },
                        { key: 'pose', label: 'Pose', url: j.inputImages?.pose },
                        { key: 'upper', label: 'Upper Garment', url: j.inputImages?.upper },
                        { key: 'lower', label: 'Lower Garment', url: j.inputImages?.lower },
                        { key: 'shoe', label: 'Shoes', url: j.inputImages?.shoe },
                        {
                          key: 'output',
                          label: 'Output',
                          url: j.thumbnailUrl ?? j.outputUrl,
                          previewUrl: j.outputUrl,
                        },
                      ] as {
                        key: string;
                        label: string;
                        url?: string | null;
                        previewUrl?: string | null;
                      }[]
                    ).map(({ key, label, url, previewUrl }) => {
                      if (!url) return null;
                      return (
                        <div key={key} style={{ textAlign: 'center' }}>
                          <a href={previewUrl ?? url} target="_blank" rel="noreferrer">
                            {/* biome-ignore lint/performance/noImgElement: presigned R2 job asset preview */}
                            <img
                              src={url}
                              alt={label}
                              style={{
                                width: 110,
                                height: 110,
                                objectFit: 'cover',
                                borderRadius: 'var(--r)',
                                border: '1px solid var(--border)',
                              }}
                            />
                          </a>
                          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                            {label}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {confirmCancelId && (
          <div className="modal-overlay" onClick={() => setConfirmCancelId(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-head">
                <h3>Cancel job</h3>
              </div>
              <div className="modal-body">
                <p>
                  Cancel job <strong>{confirmCancelId}</strong>? Credits will be refunded.
                </p>
              </div>
              <div className="modal-foot">
                <button
                  className="btn ghost"
                  onClick={() => setConfirmCancelId(null)}
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

  // ── List view ────────────────────────────────────────────────────────────
  return (
    <>
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
      <div className="page-head">
        <div>
          <h1>Jobs</h1>
          <p className="lede">
            {loading ? 'Loading…' : `${total.toLocaleString()} jobs`} — real-time generation queue,
            worker allocation &amp; processing history.
          </p>
        </div>
        <div className="head-tools">
          <button
            className="btn ghost"
            onClick={() => void load(filter, query)}
            disabled={loading}
            title="Refresh jobs list"
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
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

      <div className="filter-card" style={{ marginBottom: 16 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          <div className="segmented-control" role="tablist">
            {FILTERS.map((f) => {
              const isActive = filter === f.k;
              return (
                <button
                  key={f.k}
                  type="button"
                  className={`segmented-btn ${isActive ? 'active' : ''}`}
                  onClick={() => setFilter(f.k)}
                >
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: '50%',
                      display: 'inline-block',
                      background:
                        f.k === 'all'
                          ? 'var(--accent)'
                          : f.k === 'QUEUED'
                            ? 'var(--warn)'
                            : f.k === 'GENERATING'
                              ? 'var(--info)'
                              : f.k === 'COMPLETED'
                                ? 'var(--success)'
                                : f.k === 'FAILED'
                                  ? 'var(--danger)'
                                  : 'var(--muted)',
                    }}
                  />
                  {f.l}
                </button>
              );
            })}
          </div>
        </div>

        <div className="filter-row" style={{ paddingTop: 4 }}>
          <div className="filter-search-box">
            <Icon.Search />
            <input
              placeholder="Search by Job ID, User ID, or user email…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button
                type="button"
                className="filter-clear-btn"
                onClick={() => setQuery('')}
                title="Clear search"
              >
                <Icon.Close />
              </button>
            )}
          </div>
        </div>
      </div>

      {loading ? (
        <div
          style={{ color: 'var(--muted)', fontSize: 13, padding: '32px 0', textAlign: 'center' }}
        >
          Loading…
        </div>
      ) : (
        <div className="desktop-only table-wrap">
          <table>
            <thead>
              <tr>
                <th>Job ID</th>
                <th>User</th>
                <th>Job Type</th>
                <th>Status</th>
                <th>Credits</th>
                <th>Worker</th>
                <th>Created</th>
                <th>Duration</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} onClick={() => void openDetail(j)} style={{ cursor: 'pointer' }}>
                  <td>
                    <span className="mono sub" style={{ fontSize: 11 }}>
                      {j.id.slice(0, 8)}…
                    </span>
                  </td>
                  <td>
                    <span className="semi">{jobContactEmail(j) ?? '—'}</span>
                    {j.shopDomain && (
                      <div className="sub" style={{ fontSize: 11 }}>
                        {j.shopDomain}
                      </div>
                    )}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <JobTypeBadge jobType={j.jobType} />
                      {j.parentJobId && (
                        <span
                          className="badge"
                          title="Created by regenerating another job"
                          style={{ fontSize: 10, color: 'var(--warn, #b8860b)' }}
                        >
                          Regen
                        </span>
                      )}
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
                    <span className="mono sub" style={{ fontSize: 11 }}>
                      {fmtDuration(j) ?? '—'}
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
                            setConfirmCancelId(j.id);
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
              {jobs.length === 0 && (
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
      )}

      {confirmCancelId && (
        <div className="modal-overlay" onClick={() => setConfirmCancelId(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Cancel job</h3>
            </div>
            <div className="modal-body">
              <p>
                Cancel job <strong>{confirmCancelId}</strong>? Credits will be refunded.
              </p>
            </div>
            <div className="modal-foot">
              <button
                className="btn ghost"
                onClick={() => setConfirmCancelId(null)}
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
