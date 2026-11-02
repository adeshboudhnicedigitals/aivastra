import { useEffect, useState } from 'react';
import type { FleetSnapshot } from './contracts';
import {
  type LiveJob,
  type LiveJobDetail,
  type LiveWorkerConfig,
  type LiveWorkerHistory,
  loadJob,
  loadJobSources,
  loadJobs,
  loadWorkerConfig,
  loadWorkerHistory,
  OpsApiError,
} from './live-ops';

const STATUSES = [
  '',
  'QUEUED',
  'PREPROCESSING',
  'GENERATING',
  'UPLOADING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'HELD',
];
const lanes: Record<string, string> = {
  'jobs:priority': 'Priority',
  'jobs:normal': 'Normal',
  'jobs:low': 'Low',
  'jobs:video': 'Video',
  'jobs:inhouse': 'In-house',
};

function eventSummary(payload: unknown) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    return 'No structured event fields';
  const fields = ['workerId', 'workflowTemplateId', 'promptId', 'status', 'errorCode', 'reason'];
  const safe = Object.fromEntries(
    fields.flatMap((key) => {
      const value = (payload as Record<string, unknown>)[key];
      return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
        ? [[key, value]]
        : [];
    }),
  );
  return Object.keys(safe).length ? JSON.stringify(safe, null, 2) : 'No displayable event fields';
}

function StatusFilter({
  value,
  onChange,
  options = STATUSES,
  label = 'Status',
}: {
  value: string;
  onChange: (value: string) => void;
  options?: string[];
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const selectedLabel = value || `All ${label.toLowerCase()}s`;
  return (
    <div className="live-status-filter">
      <span>{label}</span>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {selectedLabel} <span aria-hidden="true">⌄</span>
      </button>
      {open && (
        <div
          role="listbox"
          aria-label={`Filter by job ${label.toLowerCase()}`}
          className="live-status-options"
        >
          {options.map((item) => (
            <button
              type="button"
              role="option"
              aria-selected={value === item}
              key={item}
              onClick={() => {
                onChange(item);
                setOpen(false);
              }}
            >
              {item || `All ${label.toLowerCase()}s`}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function HistoryDots({
  history,
  metric,
}: {
  history: LiveWorkerHistory;
  metric: 'vramUsedMb' | 'ramUsedGb';
}) {
  const points = history.points.filter((point) => point[metric] !== null);
  if (!points.length) return <p className="muted">No data in this window.</p>;
  const max = Math.max(1, ...points.map((point) => point[metric] ?? 0));
  const generatedAt = Date.parse(history.generatedAt);
  const rangeMs = history.windowMinutes * 60_000;
  return (
    <svg
      className="history-dots"
      viewBox="0 0 100 40"
      role="img"
      aria-label={`${metric === 'vramUsedMb' ? 'GPU VRAM' : 'Host RAM'} observed samples over ${history.windowMinutes} minutes. Points are not connected across unobserved intervals.`}
    >
      <path d="M0 39.5H100" className="history-axis" />
      {points.map((point) => {
        const x = Math.max(1, Math.min(99, 100 - ((generatedAt - point.t) / rangeMs) * 100));
        const y = 37 - ((point[metric] ?? 0) / max) * 31;
        return (
          <circle key={`${point.t}-${metric}`} cx={x} cy={y} r="1.7">
            <title>{`${new Date(point.t).toLocaleString()}: ${point[metric]}`}</title>
          </circle>
        );
      })}
    </svg>
  );
}

export function LiveQueuePage({
  data,
  openJobs,
  stale = false,
}: {
  data: FleetSnapshot;
  openJobs: () => void;
  stale?: boolean;
}) {
  return (
    <>
      <div className="live-intro">
        <span className="eyebrow">DISPATCH PRESSURE</span>
        <h2>Queue lanes</h2>
        <p>
          Shared Redis backlog from the latest fleet snapshot. A stale or absent sample remains
          unknown.
        </p>
      </div>
      <div className="live-lanes">
        {(data.queues ?? []).map((queue) => (
          <section className="panel live-lane" key={queue.stream}>
            <div className="panel-heading">
              <h3>{lanes[queue.stream] ?? queue.stream}</h3>
              <span className="mono">{queue.stream}</span>
            </div>
            <div className="live-lane-metrics">
              <div>
                <small>Waiting</small>
                <strong>
                  {stale || queue.waiting === null
                    ? 'Unknown'
                    : `${queue.waiting.toLocaleString()}${queue.capped ? '+' : ''}`}
                </strong>
              </div>
              <div>
                <small>In flight</small>
                <strong>
                  {stale || queue.inFlight === null ? 'Unknown' : queue.inFlight.toLocaleString()}
                </strong>
              </div>
            </div>
            <small className="muted">
              {queue.capped
                ? 'Count reached the API reporting cap.'
                : 'Observed in the latest API snapshot.'}
            </small>
          </section>
        ))}
      </div>
      <button className="button-secondary" type="button" onClick={openJobs}>
        Inspect jobs →
      </button>
    </>
  );
}

export function LiveJobsPage({
  baseUrl,
  token,
  workerId,
  jobId,
  onOpenJob,
}: {
  baseUrl: string;
  token: string;
  workerId?: string | null;
  jobId?: string | null;
  onOpenJob: (id: string | null) => void;
}) {
  const [status, setStatus] = useState(
    () => new URLSearchParams(location.search).get('jobStatus') ?? '',
  );
  const [search, setSearch] = useState(
    () => new URLSearchParams(location.search).get('jobQ') ?? '',
  );
  const [jobType, setJobType] = useState(
    () => new URLSearchParams(location.search).get('jobType') ?? '',
  );
  const [createdFrom, setCreatedFrom] = useState(
    () => new URLSearchParams(location.search).get('from') ?? '',
  );
  const [createdTo, setCreatedTo] = useState(
    () => new URLSearchParams(location.search).get('to') ?? '',
  );
  const [workerFilter, setWorkerFilter] = useState(
    () => new URLSearchParams(location.search).get('workerId') ?? '',
  );
  const [sources, setSources] = useState<string[]>([]);
  const [failureGroups, setFailureGroups] = useState<[string, number][]>([]);
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<LiveJob[]>([]);
  const [total, setTotal] = useState(0);
  const [detail, setDetail] = useState<LiveJobDetail | null>(null);
  const [openId, setOpenId] = useState<string | null>(() =>
    new URLSearchParams(location.search).get('job'),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => setOpenId(jobId ?? null), [jobId]);
  useEffect(() => {
    let current = true;
    loadJobSources(baseUrl, token)
      .then((value) => {
        if (current) setSources(value);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [baseUrl, token]);
  const syncJobFilters = (values: Record<string, string>) => {
    const params = new URLSearchParams(location.search);
    for (const [key, value] of Object.entries(values))
      value ? params.set(key, value) : params.delete(key);
    window.history.replaceState(null, '', `${location.pathname}?${params.toString()}`);
  };
  useEffect(() => {
    const restoreFilters = () => {
      const params = new URLSearchParams(location.search);
      setStatus(params.get('jobStatus') ?? '');
      setSearch(params.get('jobQ') ?? '');
      setJobType(params.get('jobType') ?? '');
      setCreatedFrom(params.get('from') ?? '');
      setCreatedTo(params.get('to') ?? '');
      setWorkerFilter(params.get('workerId') ?? '');
    };
    window.addEventListener('popstate', restoreFilters);
    return () => window.removeEventListener('popstate', restoreFilters);
  }, []);

  useEffect(() => {
    let current = true;
    setLoading(true);
    loadJobs(baseUrl, token, {
      page,
      pageSize: 25,
      workerId: (workerId ?? workerFilter) || undefined,
      status: status || undefined,
      search: search || undefined,
      jobType: jobType || undefined,
      createdFrom: createdFrom || undefined,
      createdTo: createdTo || undefined,
    })
      .then((result) => {
        if (current) {
          setItems(result.items);
          setTotal(result.total);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (current) setError(err instanceof Error ? err : new Error('Jobs unavailable.'));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [
    baseUrl,
    token,
    page,
    workerId,
    workerFilter,
    status,
    search,
    jobType,
    createdFrom,
    createdTo,
  ]);

  useEffect(() => {
    let current = true;
    loadJobs(baseUrl, token, {
      pageSize: 100,
      workerId: (workerId ?? workerFilter) || undefined,
      status: 'FAILED',
      search: search || undefined,
      jobType: jobType || undefined,
      createdFrom: createdFrom || undefined,
      createdTo: createdTo || undefined,
    })
      .then((result) => {
        if (current)
          setFailureGroups(
            Object.entries(
              result.items.reduce<Record<string, number>>((groups, job) => {
                const key = job.workerId ?? 'Unknown worker';
                groups[key] = (groups[key] ?? 0) + 1;
                return groups;
              }, {}),
            ).sort((a, b) => b[1] - a[1]),
          );
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [baseUrl, token, workerId, workerFilter, search, jobType, createdFrom, createdTo]);

  useEffect(() => {
    if (!openId) {
      setDetail(null);
      return;
    }
    let current = true;
    loadJob(baseUrl, token, openId)
      .then((value) => {
        if (current) setDetail(value);
      })
      .catch((err: unknown) => {
        if (current) setError(err instanceof Error ? err : new Error('Job details unavailable.'));
      });
    return () => {
      current = false;
    };
  }, [baseUrl, token, openId]);

  const open = (id: string | null) => {
    setOpenId(id);
    onOpenJob(id);
  };
  if (error instanceof OpsApiError && error.status === 403)
    return (
      <div className="permission-panel" role="status">
        <strong>Jobs are restricted</strong>
        <p>
          Your role lacks <code>jobs.read</code>.
        </p>
      </div>
    );
  return (
    <>
      <div className="live-intro">
        <span className="eyebrow">JOB INVESTIGATION</span>
        <h2>{workerId ? `Jobs on ${workerId}` : 'Jobs'}</h2>
        <p>Inspect job status, worker assignment, failures, attempts, and recorded events.</p>
      </div>
      <div className="live-job-filters">
        <label>
          Search job ID or account
          <input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              syncJobFilters({ jobQ: event.target.value });
              setPage(1);
            }}
            placeholder="Search jobs"
          />
        </label>
        <StatusFilter
          value={status}
          onChange={(value) => {
            setStatus(value);
            syncJobFilters({ jobStatus: value });
            setPage(1);
          }}
        />
        <label>
          Worker ID
          <input
            value={workerId ?? workerFilter}
            disabled={Boolean(workerId)}
            onChange={(event) => {
              setWorkerFilter(event.target.value);
              syncJobFilters({ workerId: event.target.value });
              setPage(1);
            }}
            placeholder="Any worker"
          />
        </label>
        <StatusFilter
          value={jobType}
          label="Source"
          options={['', ...sources]}
          onChange={(value) => {
            setJobType(value);
            syncJobFilters({ jobType: value });
            setPage(1);
          }}
        />
        <label>
          Created from
          <input
            type="datetime-local"
            value={createdFrom}
            onChange={(event) => {
              setCreatedFrom(event.target.value);
              syncJobFilters({ from: event.target.value });
              setPage(1);
            }}
          />
        </label>
        <label>
          Created to
          <input
            type="datetime-local"
            value={createdTo}
            onChange={(event) => {
              setCreatedTo(event.target.value);
              syncJobFilters({ to: event.target.value });
              setPage(1);
            }}
          />
        </label>
        {workerId && (
          <button type="button" className="button-secondary" onClick={() => onOpenJob(null)}>
            Clear worker filter
          </button>
        )}
      </div>
      {error && (
        <div className="permission-panel" role="alert">
          {error.message}
        </div>
      )}
      <section className="panel failure-groups">
        <h3>Failed jobs by worker</h3>
        <p className="muted">
          First 100 failed jobs matching the worker, source, search and time filters.
        </p>
        {failureGroups.length ? (
          failureGroups.map(([worker, count]) => (
            <div key={worker}>
              <span>{worker}</span>
              <strong>{count}</strong>
            </div>
          ))
        ) : (
          <p>No failures in this result window.</p>
        )}
      </section>
      {loading ? (
        <div className="panel empty" aria-live="polite">
          Loading jobs…
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Job</th>
                <th>Status</th>
                <th>Worker</th>
                <th>Type</th>
                <th>Created</th>
                <th>Failure</th>
              </tr>
            </thead>
            <tbody>
              {items.map((job) => (
                <tr key={job.id}>
                  <td>
                    <button type="button" className="text-link mono" onClick={() => open(job.id)}>
                      {job.id}
                    </button>
                  </td>
                  <td>{job.status}</td>
                  <td>{job.workerId ?? 'Unknown'}</td>
                  <td>{job.jobType ?? 'Unknown'}</td>
                  <td>{new Date(job.createdAt).toLocaleString()}</td>
                  <td>{job.errorCode ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {items.length === 0 && <div className="empty">No jobs match these filters.</div>}
        </div>
      )}
      <div className="live-pagination">
        <span>{total.toLocaleString()} matching jobs</span>
        <div>
          <button
            type="button"
            className="button-secondary"
            disabled={page <= 1}
            onClick={() => setPage((value) => value - 1)}
          >
            Previous
          </button>
          <span>Page {page}</span>
          <button
            type="button"
            className="button-secondary"
            disabled={page * 25 >= total}
            onClick={() => setPage((value) => value + 1)}
          >
            Next
          </button>
        </div>
      </div>
      {openId && (
        <div className="live-drawer-backdrop" role="presentation">
          <aside
            className="live-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="job-detail-title"
          >
            <button
              type="button"
              className="live-drawer-close"
              onClick={() => open(null)}
              aria-label="Close job details"
            >
              ×
            </button>
            <span className="eyebrow">JOB DETAIL</span>
            <h2 id="job-detail-title">{detail?.id ?? openId}</h2>
            {detail ? (
              <>
                <dl>
                  <dt>Status</dt>
                  <dd>{detail.status}</dd>
                  <dt>Worker</dt>
                  <dd>{detail.workerId ?? 'Not assigned'}</dd>
                  <dt>Type</dt>
                  <dd>{detail.jobType ?? 'Unknown'}</dd>
                  <dt>Failure code</dt>
                  <dd>{detail.errorCode ?? 'No failure recorded'}</dd>
                  <dt>Error message</dt>
                  <dd>Not exposed by the current jobs API.</dd>
                  <dt>Attempts</dt>
                  <dd>{detail.attempts}</dd>
                  <dt>Credits refunded</dt>
                  <dd>Not exposed by the current jobs API.</dd>
                </dl>
                <h3>Event timeline</h3>
                <ol className="job-timeline">
                  {detail.events.map((event) => (
                    <li key={event.id}>
                      <time>{new Date(event.createdAt).toLocaleString()}</time>
                      <strong>{event.eventType}</strong>
                      <pre>{eventSummary(event.payload)}</pre>
                    </li>
                  ))}
                </ol>
              </>
            ) : (
              <p aria-live="polite">Loading job detail…</p>
            )}
          </aside>
        </div>
      )}
    </>
  );
}

export function WorkerLivePanel({
  baseUrl,
  token,
  workerId,
  onOpenJob,
}: {
  baseUrl: string;
  token: string;
  workerId: string;
  onOpenJob: (id: string) => void;
}) {
  const [tab, setTab] = useState<'overview' | 'jobs' | 'config'>('overview');
  const [config, setConfig] = useState<LiveWorkerConfig | null>(null);
  const [history, setHistory] = useState<LiveWorkerHistory | null>(null);
  const [historyError, setHistoryError] = useState<Error | null>(null);
  const [jobs, setJobs] = useState<LiveJob[]>([]);
  const [configError, setConfigError] = useState<Error | null>(null);
  const [jobsError, setJobsError] = useState<Error | null>(null);
  useEffect(() => {
    let current = true;
    loadWorkerConfig(baseUrl, token, workerId)
      .then((value) => {
        if (current) setConfig(value);
      })
      .catch((error: unknown) => {
        if (current)
          setConfigError(error instanceof Error ? error : new Error('Worker config unavailable.'));
      });
    loadWorkerHistory(baseUrl, token, workerId)
      .then((value) => {
        if (current) setHistory(value);
      })
      .catch((error: unknown) => {
        if (current)
          setHistoryError(
            error instanceof Error ? error : new Error('Worker history unavailable.'),
          );
      });
    loadJobs(baseUrl, token, { workerId, pageSize: 10 })
      .then((value) => {
        if (current) setJobs(value.items);
      })
      .catch((error: unknown) => {
        if (current)
          setJobsError(error instanceof Error ? error : new Error('Worker jobs unavailable.'));
      });
    return () => {
      current = false;
    };
  }, [baseUrl, token, workerId]);

  return (
    <section className="panel worker-live-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">LIVE WORKER RECORD</span>
          <h2>Worker workspace</h2>
        </div>
        <button
          type="button"
          className="button-secondary"
          onClick={() => navigator.clipboard.writeText(workerId).catch(() => undefined)}
        >
          Copy worker ID
        </button>
      </div>
      <div className="live-tabs" role="tablist" aria-label="Worker detail sections">
        {(['overview', 'jobs', 'config'] as const).map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={tab === item}
            onClick={() => setTab(item)}
          >
            {item === 'overview' ? 'Overview' : item === 'jobs' ? 'Jobs' : 'Config'}
          </button>
        ))}
      </div>
      {tab === 'overview' && (
        <div className="detail-grid live-detail-facts">
          <section>
            <h3>Current state</h3>
            <p>Worker health and routing come from the API fleet snapshot.</p>
            <p>
              Unreachable means the worker health key is not currently valid. Unknown means the API
              has no observed value.
            </p>
          </section>
          <section>
            <h3>Telemetry boundary</h3>
            <p>ComfyUI queue and VRAM are reported only when the corresponding sample is fresh.</p>
            <p>Host mapping, GPU utilization, temperature and disk remain unknown.</p>
          </section>
        </div>
      )}
      {tab === 'overview' && (
        <div className="permission-panel">
          <strong>Drain controls are unavailable</strong>
          <p>
            The current API route does not accept or audit a typed reason, so this UI will not send
            a drain or undrain request.
          </p>
          <button type="button" className="button-secondary" disabled>
            Drain / undrain
          </button>
        </div>
      )}
      {tab === 'overview' && (
        <section className="history-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">OBSERVED HISTORY</span>
              <h3>{history ? `Last ${history.windowMinutes} minutes` : 'Worker history'}</h3>
            </div>
            {history && (
              <span className="muted">
                Generated {new Date(history.generatedAt).toLocaleTimeString()}
              </span>
            )}
          </div>
          {historyError ? (
            <p className="muted">{historyError.message}</p>
          ) : history ? (
            <div className="history-grid">
              <div>
                <div className="panel-heading">
                  <strong>GPU VRAM used</strong>
                  <span>
                    {history.points.at(-1)?.vramUsedMb ?? 'No data'}
                    {history.points.at(-1)?.vramUsedMb === null || !history.points.length
                      ? ''
                      : ' MB'}
                  </span>
                </div>
                <HistoryDots history={history} metric="vramUsedMb" />
              </div>
              <div>
                <div className="panel-heading">
                  <strong>Host RAM used</strong>
                  <span>
                    {history.points.at(-1)?.ramUsedGb ?? 'No data'}
                    {history.points.at(-1)?.ramUsedGb === null || !history.points.length
                      ? ''
                      : ' GB'}
                  </span>
                </div>
                <HistoryDots history={history} metric="ramUsedGb" />
              </div>
            </div>
          ) : (
            <p className="muted" aria-live="polite">
              Loading worker history…
            </p>
          )}
          <small className="muted">
            Each dot is an observed sample. Missing intervals stay visible; values are not
            interpolated.
          </small>
        </section>
      )}
      {tab === 'jobs' &&
        (jobsError ? (
          <div className="permission-panel">
            {jobsError instanceof OpsApiError && jobsError.status === 403 ? (
              <>
                Your role lacks <code>jobs.read</code>.
              </>
            ) : (
              jobsError.message
            )}
          </div>
        ) : jobs.length ? (
          <div className="live-worker-job-list">
            {jobs.map((job) => (
              <div key={job.id}>
                <button className="text-link mono" type="button" onClick={() => onOpenJob(job.id)}>
                  {job.id}
                </button>
                <span>
                  {job.status} · {job.jobType ?? 'Unknown type'}
                </span>
                <span>{job.errorCode ?? 'No failure recorded'}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">No jobs returned for this worker.</p>
        ))}
      {tab === 'config' &&
        (configError ? (
          <div className="permission-panel">
            {configError instanceof OpsApiError && configError.status === 403 ? (
              <>
                Your role lacks <code>workers.read</code>.
              </>
            ) : (
              configError.message
            )}
          </div>
        ) : config ? (
          <dl>
            <dt>Registered label</dt>
            <dd>{config.label}</dd>
            <dt>Active</dt>
            <dd>{config.isActive ? 'Yes' : 'No'}</dd>
            <dt>Registry presence</dt>
            <dd>{config.inRegistry ? 'Present' : 'Not present'}</dd>
            <dt>Health</dt>
            <dd>{config.healthy ? 'Healthy' : 'Unhealthy'}</dd>
            <dt>Dispatcher state</dt>
            <dd>{config.status}</dd>
            <dt>Allowed job types</dt>
            <dd>
              {config.allowedJobTypes.length
                ? config.allowedJobTypes.join(', ')
                : 'No types recorded'}
            </dd>
            <dt>Last seen</dt>
            <dd>
              {config.lastSeen === null
                ? 'Not observed'
                : new Date(config.lastSeen).toLocaleString()}
            </dd>
          </dl>
        ) : (
          <p aria-live="polite">Loading registered worker configuration…</p>
        ))}
    </section>
  );
}
