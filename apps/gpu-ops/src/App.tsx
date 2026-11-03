import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityPage } from './ActivityPage';
import { DevStateGallery } from './AgentPanels';
import type { AuthRecovery } from './auth';
import { login, logout, refresh } from './auth';
import { ConfigurationPage } from './ConfigurationPage';
import { LoginForm } from './Connect';
import type { FleetSnapshot, FleetWorkerView, IncidentView } from './contracts';
import { EvidencePage } from './EvidencePage';
import { fixtureRepository } from './fixtures';
import {
  agentHostFacts,
  comfyView,
  dispatcherLabel,
  fleetTiles,
  isTelemetryOnly,
  withAgentGpu,
} from './fleet-view';
import { HostResources } from './HostResources';
import { AlertRulesPage, IncidentFixtureGallery, LiveIncidentsPage } from './IncidentsPages';
import { InventoryEditor } from './InventoryEditor';
import { LiveActivityPage } from './LiveActivityPage';
import { LiveInventoryPage } from './LiveInventoryPage';
import { LiveOperationsPage } from './LiveOperationsPage';
import { LiveJobsPage, LiveQueuePage, WorkerLivePanel } from './LivePages';
import { createLiveRepository, FleetLoadError } from './live';
import type { FleetAgentSummaries, FleetAgentSummary } from './live-agent';
import { loadFleetAgentSummaries } from './live-agent';
import { type IncidentSummary, loadIncidentSummary } from './live-incidents';
import {
  applyInventory,
  type Inventory as FleetInventory,
  inventoryErrorMessage,
  loadInventory,
} from './live-inventory';
import { loadOperations, type Operations, operationsErrorMessage } from './live-operations';
import { display, fleetCounts, freshness, grafanaLink, reconciliation, signals } from './model';
import type { OperationsManager } from './OperationsControls';
import { IncidentActions, OperationsControls, useOperationsDemo } from './OperationsControls';
import { incidentPreview } from './operations-demo';
import type { ProcessManager } from './ProcessControls';
import { ProcessControls, useProcessDemo } from './ProcessControls';
import { QueuePage } from './QueuePage';
import { useWorkspaceDemo } from './Workspace';

type Page =
  | 'fleet'
  | 'inventory'
  | 'incidents'
  | 'operations'
  | 'queue'
  | 'configuration'
  | 'evidence'
  | 'activity'
  | 'rules';
type LivePage = Page | 'jobs';
const pages: { id: Page; label: string; icon: string }[] = [
  { id: 'fleet', label: 'Fleet overview', icon: '◫' },
  { id: 'inventory', label: 'Inventory', icon: '▤' },
  { id: 'incidents', label: 'Incidents', icon: '◇' },
  { id: 'operations', label: 'Operations', icon: '◎' },
  { id: 'queue', label: 'Job queue', icon: '≋' },
  { id: 'configuration', label: 'Instance config', icon: '⚙' },
  { id: 'evidence', label: 'Evidence', icon: '▧' },
  { id: 'activity', label: 'Activity log', icon: '↺' },
];
const livePages: { id: LivePage; label: string; icon: string }[] = [
  { id: 'fleet', label: 'Fleet overview', icon: '◫' },
  { id: 'jobs', label: 'Jobs debug', icon: '≋' },
  { id: 'queue', label: 'Queue lanes', icon: '▤' },
  { id: 'incidents', label: 'Incidents', icon: '◇' },
  { id: 'inventory', label: 'Inventory', icon: '▤' },
  { id: 'operations', label: 'Operations', icon: '◎' },
  { id: 'rules', label: 'Alert rules', icon: '⚑' },
  { id: 'activity', label: 'Activity log', icon: '↺' },
];
function tone(text: string) {
  if (['UNREACHABLE', 'CRITICAL', 'HIGH', 'FOREIGN', 'OPEN', 'ERROR'].includes(text))
    return 'danger';
  if (['DEGRADED', 'DRAINING', 'UNATTRIBUTED', 'ACK', 'STALE', 'MEDIUM', 'PARTIAL'].includes(text))
    return 'warning';
  if (
    ['HEALTHY', 'FRESH', 'PRODUCTION', 'RECOVERED', 'AVAILABLE', 'IDLE', 'SUCCEEDED'].includes(text)
  )
    return 'good';
  if (text === 'BUSY') return 'blue';
  return 'neutral';
}
function Badge({ value }: { value: string }) {
  return (
    <span className={`badge ${tone(value)}`}>
      <span className="dot" />
      {value.replaceAll('_', ' ')}
    </span>
  );
}
function utc(at: string | null) {
  return at ? `${new Date(at).toISOString().slice(11, 19)} UTC` : 'Not observed';
}
function Exporter({ value }: { value: boolean | null }) {
  return (
    <span className={value === true ? 'text-good' : value === false ? 'text-danger' : 'muted'}>
      {value === null ? 'Not monitored' : value ? 'Up' : 'Down'}
    </span>
  );
}
function Metric({ label, value, note }: { label: string; value: string | number; note: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}
function GpuSummary({ worker, asOf }: { worker: FleetWorkerView; asOf: string }) {
  const state = freshness(worker.monitoring.lastSeenAt, asOf);
  const pct = worker.gpu.utilizationPct;
  return (
    <div className="gpu-summary">
      <div>
        <strong>{display(pct, '%')}</strong>
        <span className="muted"> GPU</span>
      </div>
      <div className="meter" aria-hidden="true">
        {pct !== null && (
          <i
            className={state === 'FRESH' ? '' : 'stale'}
            style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
          />
        )}
      </div>
      <small>
        {worker.gpu.vramUsedMb === null
          ? 'VRAM not observed'
          : `${display(worker.gpu.vramUsedMb)} / ${display(worker.gpu.vramTotalMb)} MB`}
      </small>
      {state !== 'FRESH' && (
        <small className="text-warning">
          {state === 'STALE' ? 'Historical observation' : 'No telemetry'}
        </small>
      )}
    </div>
  );
}
function ComfyCell({
  worker,
  summary,
}: {
  worker: FleetWorkerView;
  summary: FleetAgentSummary | undefined;
}) {
  const view = comfyView(worker, summary);
  return (
    <>
      <span className={view.conflict ? 'text-warning' : undefined}>{view.headline}</span>
      {view.detail && (
        <small className={view.conflict ? 'text-warning' : 'muted'}>{view.detail}</small>
      )}
      {!isTelemetryOnly(worker) && (
        <small>
          <Badge value={worker.ownership} />
        </small>
      )}
    </>
  );
}
function agentObservationLabel(summary: FleetAgentSummary) {
  if (!summary.telemetry) return 'Agent has not reported';
  return summary.telemetry.stale ? 'Historical · agent' : 'Agent';
}
function AgentGpuCell({
  summary,
  loaded,
  error,
  worker,
}: {
  summary: FleetAgentSummary | undefined;
  loaded: boolean;
  error: string | null;
  worker: FleetWorkerView;
}) {
  const dispatcherNote = `Dispatcher ComfyUI VRAM: ${display(worker.gpu.vramUsedMb)} / ${display(worker.gpu.vramTotalMb)} MiB`;
  if (error)
    return (
      <div className="agent-observation" title={error}>
        <strong>Agent data unavailable</strong>
      </div>
    );
  if (!loaded)
    return (
      <div className="agent-observation">
        <strong>Loading agent readings…</strong>
      </div>
    );
  if (!summary)
    return (
      <div className="agent-observation" title={dispatcherNote}>
        <strong>No agent</strong>
      </div>
    );
  if (!summary.telemetry)
    return (
      <div className="agent-observation" title={dispatcherNote}>
        <strong>Agent has not reported</strong>
      </div>
    );
  const t = summary.telemetry;
  return (
    <div className="agent-observation" title={dispatcherNote}>
      <strong>{agentObservationLabel(summary)}</strong>
      <small>
        Temp {display(t.tempMaxC, ' °C')} · Clock {display(t.clockRatioMin, '×')}
      </small>
      <small>
        Util {display(t.utilGpuPctMax, '%')} · Power {display(t.powerWTotal, ' W')}
      </small>
      <small>
        VRAM {display(t.vramUsedMib)} / {display(t.vramTotalMib)} MiB
      </small>
      <small>
        {t.gpuCount} GPU{t.gpuCount === 1 ? '' : 's'} · {utc(t.observedAt)}
      </small>
    </div>
  );
}
function AgentHostCell({
  summary,
  loaded,
  error,
}: {
  summary: FleetAgentSummary | undefined;
  loaded: boolean;
  error: string | null;
}) {
  if (error)
    return (
      <div className="agent-observation" title={error}>
        <strong>Agent data unavailable</strong>
      </div>
    );
  if (!loaded)
    return (
      <div className="agent-observation">
        <strong>Loading agent readings…</strong>
      </div>
    );
  if (!summary)
    return (
      <div className="agent-observation">
        <strong>No agent</strong>
      </div>
    );
  if (!summary.telemetry)
    return (
      <div className="agent-observation">
        <strong>Agent has not reported</strong>
      </div>
    );
  const t = summary.telemetry;
  const diskWarning = t.diskUsedPctMax !== null && t.diskUsedPctMax >= 90;
  return (
    <div className="agent-observation">
      <strong>{agentObservationLabel(summary)}</strong>
      <small>
        RAM available {display(t.ramAvailMib)} / {display(t.ramTotalMib)} MiB
      </small>
      <small>Swap used {display(t.swapUsedMib)} MiB</small>
      <small className={diskWarning ? 'agent-disk-warning' : undefined}>
        Disk {display(t.diskUsedPctMax, '%')}
        {diskWarning ? ' · High usage' : ''}
      </small>
    </div>
  );
}
function AgentIncidentLink({
  summary,
  onClick,
}: {
  summary: FleetAgentSummary | undefined;
  onClick: () => void;
}) {
  const counts = summary?.incidents;
  const text = counts
    ? `C ${counts.critical} · W ${counts.warning} · I ${counts.info}`
    : 'Counts unknown';
  const label = counts
    ? `${counts.critical} critical, ${counts.warning} warning, ${counts.info} info incidents`
    : 'Incident counts unknown';
  return (
    <button
      type="button"
      className={`agent-incident-link${counts?.critical ? ' has-critical' : counts?.warning ? ' has-warning' : ''}`}
      aria-label={`${label}; filter incidents for ${summary?.workerId ?? 'this worker'}`}
      title={label}
      onClick={onClick}
    >
      Incidents · {text}
    </button>
  );
}
// Build-time (VITE_*): set => read the live fleet API, unset => the synthetic fixtures.
const FLEET_API_URL = (import.meta.env.VITE_FLEET_API_URL as string | undefined) || null;
const REFRESH_MS = 15_000;
// A 401 right after a successful refresh means the new token is also unacceptable (account
// disabled, permission removed), so a second refresh would only loop.
const REAUTH_COOLDOWN_MS = 10_000;

export function App() {
  const processes = useProcessDemo();
  const operations = useOperationsDemo();
  const workspace = useWorkspaceDemo();
  const [snapshot, setSnapshot] = useState<FleetSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  // In memory only: a reload or new tab recovers it from the httpOnly refresh cookie.
  const [token, setToken] = useState<string | null>(null);
  const accessToken = useRef<string | null>(null);
  const [booting, setBooting] = useState(FLEET_API_URL !== null);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const lastRefreshAt = useRef(0);
  const refreshInFlight = useRef<Promise<string | null> | null>(null);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [incidentSummary, setIncidentSummary] = useState<IncidentSummary | null>(null);
  const [agentSummaries, setAgentSummaries] = useState<FleetAgentSummaries | null>(null);
  const [inventory, setInventory] = useState<FleetInventory | null>(null);
  const [inventoryError, setInventoryError] = useState<string | null>(null);
  const [fleetOps, setFleetOps] = useState<Operations | null>(null);
  const [fleetOpsError, setFleetOpsError] = useState<string | null>(null);
  const [agentSummaryError, setAgentSummaryError] = useState<string | null>(null);
  const refreshNow = useRef<() => Promise<boolean>>(() => Promise.resolve(false));
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('gpu-ops-theme');
    return saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  });
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showDevGallery, setShowDevGallery] = useState(
    () => import.meta.env.DEV && window.location.hash === '#/dev/states',
  );
  const shortcutPrefix = useRef(false);
  const hasData = useRef(false);
  const initialParams = new URLSearchParams(window.location.search);
  const [page, setPage] = useState<LivePage>(() => {
    const value = initialParams.get('page') ?? (initialParams.has('job') ? 'jobs' : 'fleet');
    return value &&
      [
        'fleet',
        'jobs',
        'queue',
        'incidents',
        ...(FLEET_API_URL ? ['rules', 'activity', 'inventory', 'operations'] : []),
      ].includes(value)
      ? (value as LivePage)
      : 'fleet';
  });
  const [workerId, setWorkerId] = useState<string | null>(() => initialParams.get('worker'));
  const [query, setQuery] = useState(() => initialParams.get('q') ?? '');
  const [filter, setFilter] = useState(() => initialParams.get('filter') ?? 'ALL');
  const [fleetView, setFleetView] = useState<'table' | 'cards'>('table');
  const [sortBy, setSortBy] = useState<'worker' | 'health' | 'state'>('worker');
  const [incidentId, setIncidentId] = useState<string | null>(null);
  const [incidentWorkerFilter, setIncidentWorkerFilter] = useState(
    () => initialParams.get('incidentWorker') ?? '',
  );
  const [jobId, setJobId] = useState<string | null>(() => initialParams.get('job'));
  const expireSession = useCallback(() => {
    hasData.current = false;
    accessToken.current = null;
    setSnapshot(null);
    setToken(null);
    setAuthMessage('Session expired, sign in again.');
  }, []);
  const renewAccessToken = useCallback(async () => {
    if (refreshInFlight.current) return refreshInFlight.current;
    if (!FLEET_API_URL) return null;
    if (Date.now() - lastRefreshAt.current <= REAUTH_COOLDOWN_MS) return accessToken.current;
    const pending = refresh(FLEET_API_URL)
      .then((fresh) => {
        if (fresh) {
          lastRefreshAt.current = Date.now();
          accessToken.current = fresh;
          setToken(fresh);
        }
        return fresh;
      })
      .catch(() => null)
      .finally(() => {
        refreshInFlight.current = null;
      });
    refreshInFlight.current = pending;
    return pending;
  }, []);
  const authRecovery = useMemo<AuthRecovery>(
    () => ({
      refreshAccessToken: renewAccessToken,
      onSessionExpired: expireSession,
    }),
    [renewAccessToken, expireSession],
  );
  useEffect(() => {
    const restore = () => {
      const params = new URLSearchParams(window.location.search);
      const nextPage = params.get('page');
      setPage(
        nextPage &&
          [
            'fleet',
            'jobs',
            'queue',
            'incidents',
            ...(FLEET_API_URL ? ['rules', 'activity', 'inventory', 'operations'] : []),
          ].includes(nextPage)
          ? (nextPage as LivePage)
          : 'fleet',
      );
      setWorkerId(params.get('worker'));
      setJobId(params.get('job'));
      setQuery(params.get('q') ?? '');
      setFilter(params.get('filter') ?? 'ALL');
      setIncidentWorkerFilter(params.get('incidentWorker') ?? '');
    };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const updateGallery = () => setShowDevGallery(window.location.hash === '#/dev/states');
    window.addEventListener('hashchange', updateGallery);
    return () => window.removeEventListener('hashchange', updateGallery);
  }, []);
  const writeRoute = (
    next: { page?: LivePage; worker?: string | null; job?: string | null },
    replace = false,
  ) => {
    const params = new URLSearchParams(window.location.search);
    if (next.page) params.set('page', next.page);
    if ('worker' in next) next.worker ? params.set('worker', next.worker) : params.delete('worker');
    if ('job' in next) next.job ? params.set('job', next.job) : params.delete('job');
    const url = `${window.location.pathname}?${params.toString()}`;
    if (replace) window.history.replaceState(null, '', url);
    else window.history.pushState(null, '', url);
  };
  const writeLocalParam = (key: string, value: string) => {
    const params = new URLSearchParams(window.location.search);
    if (value) params.set(key, value);
    else params.delete(key);
    window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
  };
  useEffect(() => {
    if (!FLEET_API_URL) return;
    let current = true;
    refresh(FLEET_API_URL)
      .then((value) => {
        if (!current) return;
        lastRefreshAt.current = Date.now();
        accessToken.current = value;
        setToken(value);
      })
      .catch((err: unknown) => {
        if (current)
          setAuthMessage(err instanceof Error ? err.message : 'Could not reach the API.');
      })
      .finally(() => {
        if (current) setBooting(false);
      });
    return () => {
      current = false;
    };
  }, []);
  useEffect(() => {
    if (FLEET_API_URL && !token) return;
    let current = true;
    const repository = FLEET_API_URL
      ? createLiveRepository(FLEET_API_URL, () => token)
      : fixtureRepository;
    const load = () => {
      if (FLEET_API_URL && token) {
        void loadFleetAgentSummaries(FLEET_API_URL, token, { recovery: authRecovery })
          .then((value) => {
            if (!current) return;
            setAgentSummaries(value);
            setAgentSummaryError(null);
          })
          .catch((cause: unknown) => {
            if (!current) return;
            setAgentSummaries(null);
            setAgentSummaryError(cause instanceof Error ? cause.message : 'Agent data unavailable');
          });
      }
      if (FLEET_API_URL && token) {
        void loadInventory(FLEET_API_URL, token, { recovery: authRecovery })
          .then((value) => {
            if (!current) return;
            setInventory(value);
            setInventoryError(null);
          })
          .catch((cause: unknown) => {
            if (!current) return;
            // Keep the last good inventory on screen; the page says why it may be out of date.
            setInventoryError(inventoryErrorMessage(cause));
          });
        void loadOperations(FLEET_API_URL, token, { recovery: authRecovery })
          .then((value) => {
            if (!current) return;
            setFleetOps(value);
            setFleetOpsError(null);
          })
          .catch((cause: unknown) => {
            if (!current) return;
            setFleetOpsError(operationsErrorMessage(cause));
          });
      }
      return repository
        .load()
        .then((value) => {
          if (!current) return false;
          hasData.current = true;
          setSnapshot(value);
          setError(null);
          setRefreshFailed(false);
          return true;
        })
        .catch((err: unknown) => {
          if (!current) return false;
          if (err instanceof FleetLoadError && err.kind === 'UNAUTHORIZED') {
            // Access tokens are short-lived: try the session cookie once before asking again.
            return renewAccessToken().then((fresh) => {
              if (!current) return false;
              if (!fresh) expireSession();
              return false;
            });
          }
          // Keep the last good snapshot on screen: its asOf is unchanged, so freshness ages
          // it to STALE on its own, and the banner says why.
          if (hasData.current) setRefreshFailed(true);
          else setError(err instanceof Error ? err.message : 'Fleet data unavailable');
          return false;
        });
    };
    refreshNow.current = () => load();
    void load();
    const timer = FLEET_API_URL && autoRefresh ? setInterval(load, REFRESH_MS) : undefined;
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [token, autoRefresh, authRecovery, expireSession, renewAccessToken]);
  useEffect(() => {
    if (!FLEET_API_URL || !token) {
      setIncidentSummary(null);
      return;
    }
    let active = true;
    const poll = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const summary = await loadIncidentSummary(FLEET_API_URL, token, { recovery: authRecovery });
        if (active) setIncidentSummary(summary);
      } catch {
        if (active) setIncidentSummary(null);
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void poll();
    };
    void poll();
    const timer = window.setInterval(poll, 30_000);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [token, authRecovery]);
  useEffect(() => {
    document.body.dataset.theme = darkMode ? 'dark' : 'light';
    localStorage.setItem('gpu-ops-theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);
  const signOut = () => {
    if (!FLEET_API_URL) return;
    void logout(FLEET_API_URL);
    hasData.current = false;
    accessToken.current = null;
    setSnapshot(null);
    setToken(null);
    setAuthMessage(null);
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable;
      if (event.key === '?' && !typing) {
        setShowShortcuts(true);
        return;
      }
      if (event.key === '/' && !typing) {
        event.preventDefault();
        document.querySelector<HTMLInputElement>('[aria-label="Search workers"]')?.focus();
        return;
      }
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
      if (shortcutPrefix.current) {
        shortcutPrefix.current = false;
        if (event.key === 'f') nav('fleet');
        if (event.key === 'j' && FLEET_API_URL) nav('jobs');
        return;
      }
      if (event.key === 'g') shortcutPrefix.current = true;
      if (event.key === 'r' && FLEET_API_URL) void refreshNow.current();
      if (event.key === 'Escape') setShowShortcuts(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  if (showDevGallery)
    return (
      <>
        <DevStateGallery />
        <IncidentFixtureGallery />
      </>
    );
  if (FLEET_API_URL && booting)
    return (
      <main className="load-state" aria-live="polite">
        Checking your session…
      </main>
    );
  if (FLEET_API_URL && !token)
    return (
      <LoginForm
        apiUrl={FLEET_API_URL}
        message={authMessage}
        onLogin={async (email, password) => {
          const value = await login(FLEET_API_URL, email, password);
          lastRefreshAt.current = Date.now();
          accessToken.current = value;
          setAuthMessage(null);
          setToken(value);
        }}
      />
    );
  if (error)
    return (
      <main className="load-state">
        <h1>Fleet data unavailable</h1>
        <p>No healthy state can be inferred. Reload to try again.</p>
        <p className="muted">{error}</p>
        <button type="button" onClick={() => window.location.reload()}>
          Reload
        </button>
      </main>
    );
  if (!snapshot)
    return (
      <main className="load-state" aria-live="polite">
        Loading operations workspace…
      </main>
    );
  const mapped = snapshot.source === 'LIVE' ? applyInventory(snapshot, inventory) : snapshot;
  const data = {
    ...mapped,
    incidents: snapshot.incidents.map((incident) => incidentPreview(incident, operations.state)),
    workers: mapped.workers.map((worker) =>
      worker.activeIncident && operations.state.incidents[worker.activeIncident.id]?.acknowledged
        ? { ...worker, activeIncident: { ...worker.activeIncident, state: 'ACK' as const } }
        : worker,
    ),
  };
  const counts = fleetCounts(data);
  // Live mode shows only what the fleet API actually observed. Every other page, and every
  // control, is still a browser-only demo, so none of them are reachable from a live snapshot.
  const live = data.source === 'LIVE';
  const visiblePages: { id: LivePage; label: string; icon: string }[] = live ? livePages : pages;
  const selected = data.workers.find((worker) => worker.workerId === workerId);
  const tiles = fleetTiles(
    data.workers.map((w) => ({
      workerId: w.workerId,
      jobTypes: w.jobTypes,
      health: w.health,
      dispatcherTelemetryFresh: freshness(w.monitoring.lastSeenAt, data.asOf) === 'FRESH',
    })),
    agentSummaries?.workers ?? null,
  );
  const agentSummaryByWorkerId = new Map(
    (agentSummaries?.workers ?? []).map((summary) => [summary.workerId, summary]),
  );
  const nav = (next: LivePage) => {
    writeRoute({ page: next, worker: null, job: null });
    writeLocalParam('q', '');
    writeLocalParam('filter', '');
    writeLocalParam('incidentWorker', '');
    setPage(next);
    setWorkerId(null);
    setJobId(null);
    setQuery('');
    setFilter('ALL');
    setIncidentId(null);
    setIncidentWorkerFilter('');
  };
  const openWorker = (id: string) => {
    writeRoute({ page: 'fleet', worker: id, job: null });
    setPage('fleet');
    setWorkerId(id);
  };
  const openIncident = (id: string) => {
    setPage('incidents');
    setWorkerId(null);
    setIncidentId(id);
    setFilter('ALL');
  };
  const openIncidentsForWorker = (id: string) => {
    writeRoute({ page: 'incidents', worker: null, job: null });
    writeLocalParam('incidentWorker', id);
    setPage('incidents');
    setWorkerId(null);
    setJobId(null);
    setIncidentId(null);
    setIncidentWorkerFilter(id);
  };
  const openJob = (id: string) => {
    writeRoute({ page: 'jobs', worker: null, job: id });
    setPage('jobs');
    setWorkerId(null);
    setJobId(id);
  };
  const title = selected
    ? selected.workerId
    : {
        fleet: 'Fleet overview',
        jobs: 'Jobs debug',
        inventory: 'Inventory & reconciliation',
        incidents: 'Incident workspace',
        operations: 'Operations status',
        queue: 'Job queue',
        configuration: 'Instance configuration',
        evidence: 'Evidence workspace',
        activity: 'Activity log',
        rules: 'Alert rules',
      }[page];
  const filtered = data.workers.filter(
    (worker) =>
      `${worker.workerId} ${worker.hostId} ${worker.gpuId} ${worker.ownership}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (filter === 'ALL' ||
        (filter === 'ATTENTION'
          ? signals(worker).length > 0 || Boolean(worker.activeIncident)
          : filter === 'NO DATA'
            ? freshness(worker.monitoring.lastSeenAt, data.asOf) !== 'FRESH'
            : filter === 'WARNING'
              ? signals(worker).length > 0
              : filter.startsWith('JOB:')
                ? worker.jobTypes.includes(filter.slice(4))
                : ['HEALTHY', 'DEGRADED', 'UNREACHABLE', 'UNKNOWN'].includes(filter)
                  ? worker.health === filter
                  : worker.dispatcherState === filter)),
  );
  const sortedWorkers = [...filtered].sort((left, right) => {
    const attentionOrder =
      Number(
        signals(right).length > 0 ||
          right.health === 'UNREACHABLE' ||
          Boolean(right.activeIncident),
      ) -
      Number(
        signals(left).length > 0 || left.health === 'UNREACHABLE' || Boolean(left.activeIncident),
      );
    if (attentionOrder !== 0) return attentionOrder;
    const leftValue =
      sortBy === 'worker'
        ? left.workerId
        : sortBy === 'health'
          ? left.health
          : left.dispatcherState;
    const rightValue =
      sortBy === 'worker'
        ? right.workerId
        : sortBy === 'health'
          ? right.health
          : right.dispatcherState;
    return leftValue.localeCompare(rightValue);
  });
  return (
    <div className="shell">
      <aside className="sidebar">
        <button type="button" className="brand" onClick={() => nav('fleet')}>
          <span className="brand-mark">A</span>
          <span>
            AIVASTRA<small>FLEET OPERATIONS</small>
          </span>
        </button>
        <div className="workspace">
          <span className="dot" />
          Operations workspace
          <small>{live ? 'Live · guarded actions' : 'Preview environment'}</small>
        </div>
        <nav aria-label="Primary">
          {visiblePages.map((item) => (
            <button
              type="button"
              key={item.id}
              className={page === item.id ? 'nav-item active' : 'nav-item'}
              onClick={() => nav(item.id)}
              aria-current={page === item.id ? 'page' : undefined}
            >
              <span aria-hidden="true">{item.icon}</span>
              {item.label}
              {item.id === 'incidents' && (
                <b
                  title={
                    incidentSummary
                      ? `${incidentSummary.open + incidentSummary.acknowledged} active incidents`
                      : 'Incident count unknown'
                  }
                >
                  {live
                    ? incidentSummary
                      ? incidentSummary.open + incidentSummary.acknowledged
                      : 'Unknown'
                    : counts.incidents}
                </b>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="eyebrow">OBSERVE · RECONCILE · RESPOND</span>
          <p>
            Detailed telemetry lives in Grafana.
            <br />
            Operational context lives here.
          </p>
          <span className="read-only">
            {live ? 'Drain · restart · clear queue' : 'Mock controls · no live access'}
          </span>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <span>
            Infrastructure <span className="crumb">/</span> GPU fleet
          </span>
          <span className="environment">
            {live ? '● Live fleet API' : '● Synthetic preview'}
            {live && (
              <span className="live-header-actions">
                <button
                  type="button"
                  className="link-button"
                  onClick={() => setAutoRefresh((value) => !value)}
                >
                  {autoRefresh ? 'Pause refresh' : 'Resume refresh'}
                </button>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => void refreshNow.current()}
                >
                  Refresh
                </button>
                <button
                  type="button"
                  className="link-button"
                  onClick={() =>
                    void navigator.clipboard.writeText(
                      JSON.stringify(
                        { generatedAt: data.asOf, workers: data.workers, queues: data.queues },
                        null,
                        2,
                      ),
                    )
                  }
                >
                  Copy snapshot JSON
                </button>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => setDarkMode((value) => !value)}
                >
                  {darkMode ? 'Light mode' : 'Dark mode'}
                </button>
                <button type="button" className="link-button" onClick={signOut}>
                  Sign out
                </button>
              </span>
            )}
          </span>
        </header>
        <main id="content">
          <div className="page-heading">
            <div>
              <span className="eyebrow">AIVASTRA INFRASTRUCTURE</span>
              <h1>{title}</h1>
              <p>
                {selected
                  ? 'Identity, ownership and evidence in one place.'
                  : 'A clear picture of your workers. An honest picture of what is unknown.'}
              </p>
            </div>
            <div className="snapshot-time">
              <span className="dot" />
              {live ? 'Live snapshot' : 'Fixture snapshot'}
              <small>{data.asOf.replace('T', ' ').replace(/\.\d+Z$|Z$/, ' UTC')}</small>
            </div>
          </div>
          {live ? (
            <>
              {refreshFailed && (
                <div className="preview-notice" role="alert">
                  <strong>REFRESH FAILED</strong>
                  <span>
                    Showing the last good snapshot. Values age to stale until the API responds
                    again.
                  </span>
                </div>
              )}
              <div className="preview-notice">
                <strong>LIVE</strong>
                <span>
                  Worker state, health and queue come from the dispatcher registry; VRAM, host RAM
                  and queued prompts from each worker's ComfyUI. Ownership matches those prompts to
                  dispatched jobs, so "unattributed" means no dispatch record, not a known outsider.
                  Agent readings fill GPU and host telemetry where available; dispatcher state
                  remains independent. Incident counts link to worker-filtered incident records.
                  Last activity is the registry's last job or status change, not a liveness signal.
                </span>
              </div>
            </>
          ) : (
            <div className="preview-notice">
              <strong>DEMO DATA</strong>
              <span>
                All hosts, observations and incidents are synthetic. No live collectors or commands
                are connected.
              </span>
            </div>
          )}
          {live && page === 'jobs' ? (
            <LiveJobsPage
              baseUrl={FLEET_API_URL ?? ''}
              token={token ?? ''}
              workerId={workerId}
              jobId={jobId}
              onOpenJob={(id) => {
                writeRoute({ page: 'jobs', worker: null, job: id }, id === null);
                setJobId(id);
              }}
            />
          ) : live && page === 'queue' ? (
            <LiveQueuePage data={data} stale={refreshFailed} openJobs={() => nav('jobs')} />
          ) : live && page === 'incidents' ? (
            <LiveIncidentsPage
              baseUrl={FLEET_API_URL ?? ''}
              token={token ?? ''}
              authRecovery={authRecovery}
              initialWorkerId={incidentWorkerFilter}
              onOpenRules={() => nav('rules')}
            />
          ) : live && page === 'inventory' ? (
            <LiveInventoryPage
              baseUrl={FLEET_API_URL ?? ''}
              token={token ?? ''}
              authRecovery={authRecovery}
              inventory={inventory}
              loadError={inventoryError}
              onInventory={setInventory}
            />
          ) : live && page === 'operations' ? (
            <LiveOperationsPage
              baseUrl={FLEET_API_URL ?? ''}
              token={token ?? ''}
              authRecovery={authRecovery}
              workerIds={data.workers.map((w) => w.workerId)}
              operations={fleetOps}
              loadError={fleetOpsError}
              onOperations={setFleetOps}
            />
          ) : live && page === 'activity' ? (
            <LiveActivityPage
              baseUrl={FLEET_API_URL ?? ''}
              token={token ?? ''}
              authRecovery={authRecovery}
            />
          ) : live && page === 'rules' ? (
            <AlertRulesPage
              baseUrl={FLEET_API_URL ?? ''}
              token={token ?? ''}
              authRecovery={authRecovery}
            />
          ) : selected ? (
            <WorkerDetail
              operations={operations}
              manager={processes}
              worker={selected}
              agentSummary={agentSummaryByWorkerId.get(selected.workerId)}
              onOpenIncidents={openIncidentsForWorker}
              data={data}
              onBack={() => {
                writeRoute({ page: 'fleet', worker: null, job: null });
                setWorkerId(null);
              }}
              openWorker={openWorker}
              openIncident={openIncident}
              openJob={openJob}
              liveBaseUrl={FLEET_API_URL}
              token={token}
              onFleetRefresh={() => refreshNow.current()}
              authRecovery={authRecovery}
              onOpenJob={(id) => {
                writeRoute({ page: 'jobs', worker: null, job: id });
                setPage('jobs');
                setWorkerId(null);
                setJobId(id);
              }}
            />
          ) : (
            <>
              {page === 'fleet' && (
                <>
                  <section className="metrics" aria-label="Fleet summary">
                    {live ? (
                      <>
                        <Metric
                          label="Workers"
                          value={counts.workers}
                          note={`${tiles.dispatchWorkers} take jobs · ${counts.workers - tiles.dispatchWorkers} telemetry-only`}
                        />
                        <Metric
                          label="Healthy"
                          value={tiles.healthy}
                          note="Job-taking workers with a health key renewed within 30 s"
                        />
                        <Metric
                          label="Unreachable"
                          value={tiles.unreachable}
                          note="Job-taking workers whose health key expired"
                        />
                        <Metric
                          label="Draining"
                          value={
                            data.workers.filter((w) => w.dispatcherState === 'DRAINING').length
                          }
                          note="Dispatcher reports draining"
                        />
                        <Metric
                          label="No fresh telemetry"
                          value={tiles.withoutTelemetry}
                          note="Neither the dispatcher nor an agent has a fresh sample"
                        />
                        <Metric
                          label="Agent reporting"
                          value={
                            agentSummaryError || agentSummaries === null
                              ? 'Unknown'
                              : `${tiles.agentReporting} of ${tiles.agentMonitored}`
                          }
                          note="Boxes with an agent key that sent a fresh sample"
                        />
                        <Metric
                          label="Queue waiting"
                          value={
                            refreshFailed || data.queues?.some((queue) => queue.waiting === null)
                              ? 'Unknown'
                              : (data.queues ?? [])
                                  .reduce((sum, queue) => sum + (queue.waiting ?? 0), 0)
                                  .toLocaleString()
                          }
                          note="Across the five shared Redis lanes"
                        />
                        <Metric
                          label="Agent VRAM"
                          value={
                            tiles.vram
                              ? `${(tiles.vram.usedMib / 1024).toFixed(0)} / ${(tiles.vram.totalMib / 1024).toFixed(0)} GiB`
                              : 'No data'
                          }
                          note={
                            tiles.vram
                              ? `Device memory on ${tiles.vram.boxes} agent-reported box${tiles.vram.boxes === 1 ? '' : 'es'}`
                              : 'No agent has a fresh, complete VRAM reading'
                          }
                        />
                      </>
                    ) : (
                      <>
                        <Metric
                          label="Physical hosts"
                          value={counts.hosts}
                          note={`${counts.gpus} physical GPUs · ${counts.workers} logical workers`}
                        />
                        <Metric
                          label="Fresh monitoring"
                          value={`${counts.monitoredHosts} / ${counts.hosts}`}
                          note="Both exporters up · observed within 2 min"
                        />
                        <Metric
                          label="Active incidents"
                          value={counts.incidents}
                          note="Open and acknowledged"
                        />
                        <Metric
                          label="Needs reconciliation"
                          value={
                            data.hosts.filter((host) => reconciliation(host, data).length > 0)
                              .length
                          }
                          note="Hosts with inventory or coverage gaps"
                        />
                      </>
                    )}
                  </section>
                  {live && data.queues && (
                    <section className="panel" aria-label="Dispatch queue">
                      <h2>Dispatch queue</h2>
                      <p className="muted">
                        Jobs in the shared Redis streams, not per worker. Waiting = not yet handed
                        to a dispatcher; in flight = handed out, not finished.
                      </p>
                      <dl>
                        {data.queues.map((queue) => (
                          <Fragment key={queue.stream}>
                            <dt>{queue.stream.replace('jobs:', '')}</dt>
                            <dd>
                              {refreshFailed || queue.waiting === null
                                ? 'Not observed'
                                : `${queue.waiting.toLocaleString()}${queue.capped ? '+' : ''} waiting`}
                              {' · '}
                              {refreshFailed || queue.inFlight === null
                                ? 'in flight unknown'
                                : `${queue.inFlight.toLocaleString()} in flight`}
                            </dd>
                          </Fragment>
                        ))}
                      </dl>
                    </section>
                  )}
                  <div className="section-title">
                    <div>
                      <h2>
                        Logical workers <span>{counts.workers}</span>
                      </h2>
                      <p>
                        {live
                          ? 'Workers requiring attention appear first.'
                          : 'Shared physical GPUs are identified explicitly.'}
                      </p>
                    </div>
                    <label className="search">
                      <span aria-hidden="true">⌕</span>
                      <input
                        aria-label="Search workers"
                        placeholder="Search worker, host or ownership…"
                        value={query}
                        onChange={(event) => {
                          setQuery(event.target.value);
                          writeLocalParam('q', event.target.value);
                        }}
                      />
                    </label>
                  </div>
                  <div className="filter-row">
                    {[
                      'ALL',
                      'ATTENTION',
                      'UNREACHABLE',
                      'DEGRADED',
                      'BUSY',
                      'DRAINING',
                      'NO DATA',
                      'WARNING',
                      ...Array.from(new Set(data.workers.flatMap((worker) => worker.jobTypes))).map(
                        (type) => `JOB:${type}`,
                      ),
                    ].map((item) => (
                      <button
                        type="button"
                        key={item}
                        aria-pressed={filter === item}
                        className={filter === item ? 'filter selected' : 'filter'}
                        onClick={() => {
                          setFilter(item);
                          writeLocalParam('filter', item === 'ALL' ? '' : item);
                        }}
                      >
                        {item === 'ALL'
                          ? 'All workers'
                          : item === 'ATTENTION'
                            ? 'Needs attention'
                            : item === 'NO DATA'
                              ? 'Monitoring gaps'
                              : item === 'WARNING'
                                ? 'Has warning'
                                : item.startsWith('JOB:')
                                  ? item.slice(4)
                                  : item[0] + item.slice(1).toLowerCase()}
                      </button>
                    ))}
                    <fieldset className="view-toggle" aria-label="Worker display">
                      <legend className="sr-only">Worker display</legend>
                      <button
                        type="button"
                        aria-pressed={fleetView === 'table'}
                        onClick={() => setFleetView('table')}
                      >
                        Table
                      </button>
                      <button
                        type="button"
                        aria-pressed={fleetView === 'cards'}
                        onClick={() => setFleetView('cards')}
                      >
                        Cards
                      </button>
                    </fieldset>
                  </div>
                  {fleetView === 'cards' ? (
                    <div className="live-worker-cards">
                      {sortedWorkers.map((worker) => {
                        const agentSummary = agentSummaryByWorkerId.get(worker.workerId);
                        return (
                          <article className="live-worker-card" key={worker.workerId}>
                            <div className="panel-heading">
                              <button
                                type="button"
                                className="worker-link"
                                onClick={() => openWorker(worker.workerId)}
                              >
                                {worker.workerId} <span aria-hidden="true">↗</span>
                              </button>
                              {!isTelemetryOnly(worker) && <Badge value={worker.health} />}
                            </div>
                            {dispatcherLabel(worker) && (
                              <span className="muted">{dispatcherLabel(worker)}</span>
                            )}
                            <ComfyCell worker={worker} summary={agentSummary} />
                            {live ? (
                              <>
                                <AgentGpuCell
                                  summary={agentSummary}
                                  loaded={agentSummaries !== null}
                                  error={agentSummaryError}
                                  worker={worker}
                                />
                                <AgentHostCell
                                  summary={agentSummary}
                                  loaded={agentSummaries !== null}
                                  error={agentSummaryError}
                                />
                                <AgentIncidentLink
                                  summary={agentSummary}
                                  onClick={() => openIncidentsForWorker(worker.workerId)}
                                />
                              </>
                            ) : (
                              <>
                                <span className="muted">
                                  GPU {display(worker.gpu.vramUsedMb)} /{' '}
                                  {display(worker.gpu.vramTotalMb)} MB ·{' '}
                                  {freshness(worker.monitoring.lastSeenAt, data.asOf)}
                                </span>
                                <span className="muted">
                                  {worker.activeIncident
                                    ? worker.activeIncident.state
                                    : 'No active incident'}
                                </span>
                              </>
                            )}
                            <span className="text-warning">
                              {signals(worker).join(' · ') || 'No dispatcher warning observed'}
                            </span>
                          </article>
                        );
                      })}
                      {!sortedWorkers.length && (
                        <div className="empty">No workers match these filters.</div>
                      )}
                    </div>
                  ) : (
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>
                              <button
                                type="button"
                                className="sort-button"
                                onClick={() => setSortBy('worker')}
                              >
                                Worker / identity ↕
                              </button>
                            </th>
                            <th>
                              <button
                                type="button"
                                className="sort-button"
                                onClick={() =>
                                  setSortBy((value) => (value === 'state' ? 'health' : 'state'))
                                }
                              >
                                Dispatcher / health ↕
                              </button>
                            </th>
                            <th>ComfyUI / ownership</th>
                            <th>GPU observation</th>
                            <th>Host observation</th>
                            <th>
                              {live ? 'Agent incidents / last activity' : 'Incident / last seen'}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedWorkers.map((worker) => {
                            const agentSummary = agentSummaryByWorkerId.get(worker.workerId);
                            return (
                              <tr key={worker.workerId}>
                                <td data-label="Worker / identity">
                                  <button
                                    type="button"
                                    className="worker-link"
                                    onClick={() => openWorker(worker.workerId)}
                                  >
                                    {worker.workerId}
                                    <span aria-hidden="true">↗</span>
                                  </button>
                                  <small>
                                    {live
                                      ? agentSummary?.telemetry
                                        ? `Agent · ${agentSummary.telemetry.gpuCount} GPU${agentSummary.telemetry.gpuCount === 1 ? '' : 's'}`
                                        : 'No agent reading'
                                      : `${worker.hostId} → ${worker.gpuId}`}
                                  </small>
                                  {data.workers.filter((other) => other.gpuId === worker.gpuId)
                                    .length > 1 && <span className="shared">Shared GPU</span>}
                                </td>
                                <td data-label="Dispatcher / health">
                                  {dispatcherLabel(worker) ? (
                                    <span className="muted">{dispatcherLabel(worker)}</span>
                                  ) : (
                                    <>
                                      <Badge value={worker.dispatcherState} />
                                      <small>
                                        <Badge value={worker.health} />
                                      </small>
                                      {worker.routing && (
                                        <small>
                                          <Badge value={worker.routing.toUpperCase()} />
                                        </small>
                                      )}
                                      {worker.warning && (
                                        <small className="text-warning">{worker.warning}</small>
                                      )}
                                      {signals(worker).map((signal) => (
                                        <small key={signal} className="text-warning">
                                          {signal}
                                        </small>
                                      ))}
                                    </>
                                  )}
                                </td>
                                <td data-label="ComfyUI / ownership">
                                  <ComfyCell worker={worker} summary={agentSummary} />
                                  {worker.prompt?.jobId && (
                                    <small>
                                      <button
                                        type="button"
                                        className="text-link mono"
                                        onClick={() => openJob(worker.prompt?.jobId ?? '')}
                                      >
                                        Current job {worker.prompt.jobId.slice(0, 8)} ↗
                                      </button>
                                    </small>
                                  )}
                                </td>
                                <td data-label="GPU observation">
                                  {live ? (
                                    <AgentGpuCell
                                      summary={agentSummary}
                                      loaded={agentSummaries !== null}
                                      error={agentSummaryError}
                                      worker={worker}
                                    />
                                  ) : (
                                    <GpuSummary worker={worker} asOf={data.asOf} />
                                  )}
                                </td>
                                <td data-label="Host observation">
                                  {live ? (
                                    <AgentHostCell
                                      summary={agentSummary}
                                      loaded={agentSummaries !== null}
                                      error={agentSummaryError}
                                    />
                                  ) : (
                                    <>
                                      <Badge
                                        value={freshness(worker.monitoring.lastSeenAt, data.asOf)}
                                      />
                                      <small>
                                        GPU <Exporter value={worker.monitoring.gpuExporterUp} />
                                      </small>
                                      <small>
                                        Host <Exporter value={worker.monitoring.nodeExporterUp} />
                                      </small>
                                    </>
                                  )}
                                </td>
                                <td data-label="Incident / last seen">
                                  {live ? (
                                    <AgentIncidentLink
                                      summary={agentSummary}
                                      onClick={() => openIncidentsForWorker(worker.workerId)}
                                    />
                                  ) : null}
                                  {!live &&
                                    (worker.activeIncident ? (
                                      <button
                                        type="button"
                                        className="text-link"
                                        onClick={() =>
                                          openIncident(worker.activeIncident?.id ?? '')
                                        }
                                      >
                                        {worker.activeIncident.id} · {worker.activeIncident.state}
                                      </button>
                                    ) : (
                                      <span className="muted">No active incident</span>
                                    ))}
                                  <small>{utc(worker.lastSeenAt)}</small>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      {filtered.length === 0 && (
                        <div className="empty">
                          No workers match these filters.
                          <button
                            type="button"
                            onClick={() => {
                              setQuery('');
                              setFilter('ALL');
                            }}
                          >
                            Clear filters
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  <p className="footnote">
                    Unknown values remain unknown. GPU observations are shared physical resources,
                    not per-worker capacity.
                  </p>
                </>
              )}
              {page === 'inventory' && (
                <InventoryEditor
                  manager={workspace}
                  data={data}
                  renderPreview={(draft) => <Inventory data={draft} openWorker={openWorker} />}
                />
              )}
              {page === 'queue' && (
                <QueuePage
                  manager={workspace}
                  operations={operations}
                  data={data}
                  openWorker={openWorker}
                />
              )}
              {page === 'configuration' && <ConfigurationPage manager={processes} data={data} />}
              {page === 'evidence' && (
                <EvidencePage manager={workspace} data={data} openIncident={openIncident} />
              )}
              {page === 'activity' && (
                <ActivityPage workspace={workspace} operations={operations} processes={processes} />
              )}
              {page === 'incidents' && (
                <>
                  <div className="section-title">
                    <div>
                      <h2>Evidence before conclusions</h2>
                      <p>
                        Existing OPEN / ACK / RECOVERED semantics. Classification remains
                        evidence-based.
                      </p>
                    </div>
                  </div>
                  <div className="filter-row">
                    {['ALL', 'OPEN', 'ACK', 'RECOVERED'].map((state) => (
                      <button
                        type="button"
                        key={state}
                        className={filter === state ? 'filter selected' : 'filter'}
                        aria-pressed={filter === state}
                        onClick={() => {
                          setFilter(state);
                          setIncidentId(null);
                        }}
                      >
                        {state === 'ALL' ? 'All incidents' : state}
                      </button>
                    ))}
                  </div>
                  <div className="incident-layout">
                    <div className="incident-list">
                      {data.incidents
                        .filter((incident) => filter === 'ALL' || incident.state === filter)
                        .map((incident) => (
                          <button
                            type="button"
                            key={incident.id}
                            className={`incident-card ${incidentId === incident.id ? 'chosen' : ''}`}
                            onClick={() => setIncidentId(incident.id)}
                          >
                            <div>
                              <span className="mono">{incident.id}</span>
                              <Badge value={incident.state} />
                            </div>
                            <h3>{incident.title}</h3>
                            <div>
                              <Badge value={incident.severity} />
                              <span>
                                {incident.workerIds.length} worker
                                {incident.workerIds.length === 1 ? '' : 's'}
                              </span>
                            </div>
                            <small>{utc(incident.updatedAt)}</small>
                          </button>
                        ))}
                    </div>
                    {data.incidents.find((incident) => incident.id === incidentId) ? (
                      <IncidentDetail
                        operations={operations}
                        incident={
                          data.incidents.find(
                            (incident) => incident.id === incidentId,
                          ) as IncidentView
                        }
                        openWorker={openWorker}
                      />
                    ) : (
                      <div className="panel empty">
                        <span className="empty-icon">◇</span>
                        <h3>Select an incident</h3>
                        <p>Review classification, evidence coverage and the audit trail.</p>
                      </div>
                    )}
                  </div>
                </>
              )}
              {page === 'operations' && (
                <>
                  <ProcessControls manager={processes} data={data} />
                  <OperationsControls manager={operations} data={data} />
                  <section className="panel safety">
                    <span className="eyebrow">OPERATIONS BOUNDARY</span>
                    <h2>Observe now. Authorize actions separately.</h2>
                    <p>
                      ComfyUI lifecycle controls simulate actions in this browser only. SSH,
                      firewall changes, process management and rebuild are not connected.
                      Reservations, routing, maintenance, incident acknowledgment and notes are
                      local simulations. Original observations remain unchanged.
                    </p>
                    <p>
                      Containment requires evidence, recorded authorization and the verified
                      operational procedure.
                    </p>
                  </section>
                </>
              )}
            </>
          )}
          <footer>
            <span>AIVASTRA Operations · v0.1</span>
            <span>{live ? 'Live fleet API' : 'Fixture mode · No live commands'}</span>
          </footer>
          {showShortcuts && (
            <div className="live-drawer-backdrop" role="presentation">
              <section
                className="shortcuts-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="shortcuts-title"
              >
                <button
                  className="live-drawer-close"
                  type="button"
                  aria-label="Close keyboard shortcuts"
                  onClick={() => setShowShortcuts(false)}
                >
                  ×
                </button>
                <h2 id="shortcuts-title">Keyboard shortcuts</h2>
                <dl>
                  <dt>
                    <kbd>/</kbd>
                  </dt>
                  <dd>Focus worker search</dd>
                  <dt>
                    <kbd>g</kbd> then <kbd>f</kbd>
                  </dt>
                  <dd>Fleet overview</dd>
                  <dt>
                    <kbd>g</kbd> then <kbd>j</kbd>
                  </dt>
                  <dd>Jobs debug</dd>
                  <dt>
                    <kbd>r</kbd>
                  </dt>
                  <dd>Refresh fleet data</dd>
                  <dt>
                    <kbd>?</kbd>
                  </dt>
                  <dd>Show shortcuts</dd>
                  <dt>
                    <kbd>Esc</kbd>
                  </dt>
                  <dd>Close this dialog</dd>
                </dl>
              </section>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
function WorkerDetail({
  operations,
  manager,
  worker: dispatcherWorker,
  agentSummary,
  onOpenIncidents,
  data,
  onBack,
  openWorker,
  openIncident,
  openJob,
  liveBaseUrl,
  token,
  authRecovery,
  onFleetRefresh,
  onOpenJob,
}: {
  operations: OperationsManager;
  manager: ProcessManager;
  worker: FleetWorkerView;
  agentSummary: FleetAgentSummary | undefined;
  onOpenIncidents: (workerId: string) => void;
  data: FleetSnapshot;
  onBack: () => void;
  openWorker: (id: string) => void;
  openIncident: (id: string) => void;
  openJob: (id: string) => void;
  liveBaseUrl: string | null;
  token: string | null;
  authRecovery: AuthRecovery;
  onFleetRefresh: () => Promise<boolean>;
  onOpenJob: (id: string) => void;
}) {
  const worker = withAgentGpu(dispatcherWorker, agentSummary);
  const agentHost = agentHostFacts(agentSummary);
  const host = data.hosts.find((item) => item.id === worker.hostId);
  const gpu = data.gpus.find((item) => item.id === worker.gpuId);
  const siblings = data.workers.filter(
    (item) => item.gpuId === worker.gpuId && item.workerId !== worker.workerId,
  );
  const jobs = data.jobs.filter((job) => job.workerId === worker.workerId);
  const incidents = data.incidents.filter((item) => item.workerIds.includes(worker.workerId));
  return (
    <>
      <button type="button" className="back" onClick={onBack}>
        ← All workers
      </button>
      <section className="identity panel">
        <div>
          <span className="eyebrow">VPS HOST</span>
          <h3>{host?.label ?? worker.hostId}</h3>
          <small>{host?.provider ?? 'Provider unknown'}</small>
        </div>
        <span aria-hidden="true">→</span>
        <div>
          <span className="eyebrow">PHYSICAL GPU</span>
          <h3>{gpu?.model ?? 'Model unknown'}</h3>
          <small>
            {worker.gpuId} · {display(gpu?.vramTotalMb ?? null, ' MB')}
          </small>
        </div>
        <span aria-hidden="true">→</span>
        <div>
          <span className="eyebrow">LOGICAL WORKER</span>
          <h3>{worker.workerId}</h3>
          <small>{worker.jobTypes.join(' · ')}</small>
        </div>
      </section>
      {siblings.length > 0 && (
        <div className="notice">
          Shared physical GPU with{' '}
          {siblings.map((sibling) => (
            <button
              type="button"
              className="text-link"
              key={sibling.workerId}
              onClick={() => openWorker(sibling.workerId)}
            >
              {sibling.workerId}
            </button>
          ))}
          . Utilization and VRAM describe the whole GPU.
        </div>
      )}
      {data.source !== 'LIVE' && (
        <>
          <ProcessControls manager={manager} data={data} workerId={worker.workerId} />
          <OperationsControls manager={operations} data={data} workerId={worker.workerId} />
        </>
      )}
      <div className="detail-grid">
        <section className="panel">
          <div className="panel-heading">
            <h2>Reconciled state</h2>
            <Badge value={worker.health} />
          </div>
          <dl>
            <dt>Dispatcher</dt>
            <dd>
              <Badge value={worker.dispatcherState} />
            </dd>
            <dt>Routing</dt>
            <dd>{worker.routing ? worker.routing.replaceAll('_', ' ') : 'Unknown'}</dd>
            <dt>Health meaning</dt>
            <dd>
              {worker.health === 'UNREACHABLE'
                ? 'Health key expired; worker is not currently available.'
                : worker.health === 'HEALTHY'
                  ? 'Dispatcher health key is current.'
                  : 'Health has not been observed.'}
            </dd>
            <dt>Warning</dt>
            <dd>{worker.warning ?? 'No warning reported'}</dd>
            <dt>Endpoint</dt>
            <dd>
              {worker.comfy.reachable === null
                ? 'Unknown'
                : worker.comfy.reachable
                  ? 'Reachable'
                  : 'Unreachable'}
            </dd>
            <dt>Queue</dt>
            <dd>
              {display(worker.comfy.running)} running / {display(worker.comfy.pending)} pending
            </dd>
            <dt>Ownership</dt>
            <dd>
              <Badge value={worker.ownership} />
            </dd>
            <dt>Current prompt</dt>
            <dd>
              {worker.prompt?.id ?? 'No prompt observed'}
              {worker.prompt?.jobId && (
                <button
                  type="button"
                  className="text-link"
                  onClick={() => openJob(worker.prompt?.jobId ?? '')}
                >
                  Open job details ↗
                </button>
              )}
            </dd>
            <dt>Prompt owner</dt>
            <dd>{worker.prompt?.owner ?? 'Unknown / no prompt'}</dd>
            <dt>Prompt observation</dt>
            <dd>{utc(worker.prompt?.observedAt ?? null)}</dd>
          </dl>
          {signals(worker).map((signal) => (
            <div className="notice" key={signal}>
              {signal}
            </div>
          ))}
        </section>
        <section className="panel">
          <div className="panel-heading">
            <h2>Telemetry snapshot</h2>
            <Badge value={freshness(worker.monitoring.lastSeenAt, data.asOf)} />
          </div>
          <GpuSummary worker={worker} asOf={data.asOf} />
          <dl>
            <dt>Temperature</dt>
            <dd>{display(worker.gpu.temperatureC, ' °C')}</dd>
            {data.source === 'LIVE' ? (
              <>
                <dt>Agent</dt>
                <dd>
                  {agentHost
                    ? `Reporting · ${utc(agentHost.observedAt)}`
                    : 'No fresh agent reading'}
                </dd>
                <dt>Disk used</dt>
                <dd>{display(agentHost?.diskUsedPct ?? null, '%')}</dd>
              </>
            ) : (
              <>
                <dt>GPU exporter</dt>
                <dd>
                  <Exporter value={worker.monitoring.gpuExporterUp} />
                </dd>
                <dt>Host exporter</dt>
                <dd>
                  <Exporter value={worker.monitoring.nodeExporterUp} />
                </dd>
                <dt>Observed at</dt>
                <dd>{utc(worker.monitoring.lastSeenAt)}</dd>
                <dt>Storage used / total</dt>
                <dd>
                  {display(host?.storage.usedGb ?? null)} / {display(host?.storage.totalGb ?? null)}{' '}
                  GB
                </dd>
                <dt>Storage observation</dt>
                <dd>{utc(host?.storage.observedAt ?? null)}</dd>
                <dt>Storage freshness</dt>
                <dd>
                  <Badge value={freshness(host?.storage.observedAt ?? null, data.asOf)} />
                </dd>
              </>
            )}
          </dl>
        </section>
        <HostResources
          host={host}
          asOf={data.asOf}
          live={data.source === 'LIVE'}
          agent={agentHost}
        />
        {data.source !== 'LIVE' && (
          <section className="panel">
            <h2>Recent jobs</h2>
            {jobs.length ? (
              jobs.map((job) => (
                <div className="job" key={job.id}>
                  <div>
                    <span className="mono">{job.id}</span>
                    <small>
                      {job.type} · {utc(job.at)}
                    </small>
                  </div>
                  <div>
                    <Badge value={job.outcome} />
                    <small>
                      {job.executionMs === null
                        ? 'Execution time unavailable'
                        : `${(job.executionMs / 1000).toFixed(1)}s execution`}
                    </small>
                  </div>
                </div>
              ))
            ) : (
              <div className="empty compact">No recent jobs in this snapshot.</div>
            )}
          </section>
        )}
        {data.source !== 'LIVE' && (
          <section className="panel">
            <h2>Recent anomalies</h2>
            {incidents.length ? (
              incidents.map((incident) => (
                <div className="anomaly" key={incident.id}>
                  <button
                    type="button"
                    className="text-link"
                    onClick={() => openIncident(incident.id)}
                  >
                    {incident.id} · {incident.title}
                  </button>
                  <small>{incident.classification.replaceAll('_', ' ')}</small>
                  <Badge value={incident.state} />
                </div>
              ))
            ) : (
              <div className="empty compact">No recorded anomalies in this snapshot.</div>
            )}
          </section>
        )}
      </div>
      <section className="panel">
        <h2>Explore in Grafana</h2>
        <p className="muted">
          GPU, host and performance history stays in Grafana. Links carry host, GPU and worker
          context.
        </p>
        <div className="grafana-links">
          {(['gpu', 'host', 'performance'] as const).map((kind) => {
            const href = grafanaLink(kind, worker);
            return href ? (
              <a key={kind} href={href} target="_blank" rel="noreferrer">
                {kind} dashboard ↗
              </a>
            ) : (
              <div key={kind}>
                <strong>{kind} dashboard</strong>
                <small>Not configured</small>
              </div>
            );
          })}
        </div>
      </section>
      {data.source === 'LIVE' && liveBaseUrl && token && (
        <WorkerLivePanel
          baseUrl={liveBaseUrl}
          token={token}
          workerId={worker.workerId}
          isDraining={worker.dispatcherState === 'DRAINING'}
          dispatcherComfy={worker.comfy}
          onFleetRefresh={onFleetRefresh}
          authRecovery={authRecovery}
          onOpenJob={onOpenJob}
          incidents={agentSummary?.incidents}
          onOpenIncidents={() => onOpenIncidents(worker.workerId)}
        />
      )}
    </>
  );
}
function Inventory({
  data,
  openWorker,
}: {
  data: FleetSnapshot;
  openWorker: (id: string) => void;
}) {
  return (
    <>
      <div className="notice">
        Three identities, one reconciliation view. Host and GPU capacity are counted once—even when
        workers share them. All counts below are synthetic.
      </div>
      <div className="inventory-grid">
        {data.hosts.map((host) => {
          const issues = reconciliation(host, data);
          return (
            <section className="panel inventory-card" key={host.id}>
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">VPS HOST · {host.id}</span>
                  <h2>{host.label}</h2>
                </div>
                <span className="host-icon" aria-hidden="true">
                  ▤
                </span>
              </div>
              <p className="muted">
                {host.provider ?? 'Provider unknown'} ·{' '}
                {host.rented === null ? 'Rental unknown' : host.rented ? 'Rented' : 'Not rented'} ·{' '}
                {host.monthlyCostUsd === null ? 'Cost unknown' : `$${host.monthlyCostUsd}/mo`}
              </p>
              {data.gpus
                .filter((gpu) => gpu.hostId === host.id)
                .map((gpu) => (
                  <div className="gpu-tree" key={gpu.id}>
                    <strong>
                      {gpu.id} <span className="muted">/ {gpu.model ?? 'GPU model unknown'}</span>
                    </strong>
                    {data.workers
                      .filter((worker) => worker.gpuId === gpu.id)
                      .map((worker) => (
                        <div className="tree-worker" key={worker.workerId}>
                          <button
                            type="button"
                            className="text-link"
                            onClick={() => openWorker(worker.workerId)}
                          >
                            {worker.workerId} ↗
                          </button>
                          <small>
                            {worker.inRegistry ? 'In registry' : 'Not in registry'} ·{' '}
                            {worker.active ? 'Active' : 'Inactive'}
                          </small>
                        </div>
                      ))}
                  </div>
                ))}
              <div className="issue-list">
                {issues.length ? (
                  issues.map((issue) => (
                    <span className="issue" key={issue}>
                      {issue}
                    </span>
                  ))
                ) : (
                  <span className="text-good">✓ Inventory reconciled</span>
                )}
              </div>
            </section>
          );
        })}
      </div>
      <p className="footnote">
        Registry-only / monitored-only describe observed coverage, not proof that an exporter is
        uninstalled. Unverified inventory requires operator reconciliation.
      </p>
    </>
  );
}
function IncidentDetail({
  operations,
  incident,
  openWorker,
}: {
  operations: OperationsManager;
  incident: IncidentView;
  openWorker: (id: string) => void;
}) {
  return (
    <section className="panel incident-detail">
      <span className="eyebrow">{incident.id} · INCIDENT RECORD</span>
      <h2>{incident.title}</h2>
      <div className="badges">
        <Badge value={incident.severity} />
        <Badge value={incident.state} />
      </div>
      <IncidentActions key={incident.id} incident={incident} manager={operations} />
      <div className="classification">
        <span className="eyebrow">CLASSIFICATION</span>
        <strong>{incident.classification.replaceAll('_', ' ')}</strong>
      </div>
      <dl>
        <dt>Opened</dt>
        <dd>{utc(incident.openedAt)}</dd>
        <dt>Updated</dt>
        <dd>{utc(incident.updatedAt)}</dd>
        <dt>Recovered</dt>
        <dd>{utc(incident.recoveredAt)}</dd>
        <dt>Job types impacted</dt>
        <dd>{incident.jobTypes.join(' · ')}</dd>
      </dl>
      <div className="badges">
        {incident.workerIds.map((id) => (
          <button type="button" className="text-link" key={id} onClick={() => openWorker(id)}>
            {id} ↗
          </button>
        ))}
      </div>
      <h3>Evidence availability</h3>
      <div className="evidence">
        {Object.entries(incident.evidence).map(([source, state]) => (
          <div key={source}>
            <span>
              {source === 'passA' ? 'Pass A' : source === 'passB' ? 'Pass B' : 'External'}
            </span>
            <Badge value={state} />
          </div>
        ))}
      </div>
      <h3>Operator notes</h3>
      {incident.notes.map((note) => (
        <p className="note" key={note}>
          {note}
        </p>
      ))}
      <h3>Audit trail</h3>
      <ol className="audit">
        {incident.audit.map((entry) => (
          <li key={`${entry.at}-${entry.action}`}>
            <small>
              {utc(entry.at)} · {entry.actor}
            </small>
            <p>{entry.action}</p>
          </li>
        ))}
      </ol>
      <p className="footnote">
        Fixture record with browser-only acknowledgment and notes. No containment or live incident
        transitions are executed here.
      </p>
    </section>
  );
}
