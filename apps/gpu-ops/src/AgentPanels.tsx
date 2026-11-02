import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibleDialog } from './AccessibleDialog';
import type { AuthRecovery } from './auth';
import type { FleetWorkerView } from './contracts';
import {
  type AgentGpu,
  type AgentStatus,
  type AgentTelemetryView,
  agentKeyErrorMessage,
  type CreatedAgentKey,
  createAgentKey,
  FleetAgentApiError,
  loadAgentStatus,
  loadAgentTelemetry,
  parseAgentStatus,
  parseAgentTelemetryView,
  parseCreatedAgentKey,
  revokeAgentKey,
} from './live-agent';
import { MetricsCharts } from './MetricsCharts';

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Fleet API request failed.';
const asOfAge = (generatedAt: string, observedAt: string) =>
  Math.max(0, Math.floor((Date.parse(generatedAt) - Date.parse(observedAt)) / 1000));
const ageLabel = (seconds: number) =>
  seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
const shown = (value: number | null, suffix = '') =>
  value === null ? 'No data' : `${value.toLocaleString()}${suffix}`;
const hours = (us: number) => {
  const s = us / 1_000_000;
  return s >= 3600
    ? `${(s / 3600).toFixed(1)} h`
    : s >= 60
      ? `${(s / 60).toFixed(1)} min`
      : `${s.toFixed(1)} s`;
};
const slowdownLabel = (gpu: AgentGpu) => {
  const parts = [
    ['heat (hardware)', gpu.hwThermalSlowdownUs],
    ['heat (software)', gpu.swThermalSlowdownUs],
    ['power cap', gpu.swPowerCapUs],
  ] as const;
  if (parts.every(([, v]) => v === null)) return 'Not reported';
  return parts.map(([label, v]) => `${label} ${v === null ? 'no data' : hours(v)}`).join(' · ');
};
const mib = (value: number | null) =>
  value === null ? 'No data' : `${(value / 1024).toFixed(1)} GiB`;

function AgentStatusContent({ status }: { status: AgentStatus }) {
  const everSeen = status.keys.some((key) => key.lastSeenAt !== null);
  const activeKeys = status.keys.filter((key) => key.revokedAt === null);
  const state = status.heartbeat
    ? 'Connected'
    : status.rejectsLastHour > 0
      ? 'Rejecting samples'
      : everSeen
        ? 'Silent'
        : activeKeys.length
          ? 'Key issued · not yet seen'
          : 'Never connected';
  return (
    <>
      <div className="agent-status-summary">
        <span
          className={`agent-state-pill ${status.heartbeat ? 'is-connected' : status.rejectsLastHour > 0 ? 'is-rejecting' : ''}`}
        >
          {state}
        </span>
        {status.heartbeat ? (
          <div className="agent-heartbeat">
            <strong>
              Heartbeat {ageLabel(asOfAge(status.generatedAt, status.heartbeat.observedAt))} before
              this response
            </strong>
            <span>
              Version {status.heartbeat.agentVersion} · boot {status.heartbeat.bootId.slice(0, 8)}
            </span>
            <small>Received {status.heartbeat.receivedAt}</small>
          </div>
        ) : status.rejectsLastHour > 0 ? (
          <p>
            The agent is reaching the server but its samples are refused · {status.rejectsLastHour}{' '}
            in the last hour.
          </p>
        ) : activeKeys.length ? (
          <p>
            {everSeen
              ? 'A key reported earlier, but there is no current heartbeat.'
              : 'A key exists, but the agent has not reported yet.'}
          </p>
        ) : (
          <p>No active agent key exists, and no heartbeat has been received.</p>
        )}
      </div>
      <div className="agent-key-table-wrap">
        <table className="agent-key-table">
          <thead>
            <tr>
              <th>Prefix</th>
              <th>Label</th>
              <th>Created</th>
              <th>Last seen</th>
              <th>Agent</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {status.keys.map((key) => (
              <tr key={key.id} className={key.revokedAt ? 'is-revoked' : ''}>
                <td className="mono">{key.keyPrefix}</td>
                <td>{key.label}</td>
                <td>{new Date(key.createdAt).toLocaleString()}</td>
                <td>{key.lastSeenAt ? new Date(key.lastSeenAt).toLocaleString() : 'Not seen'}</td>
                <td>{key.agentVersion ?? 'No data'}</td>
                <td>
                  {key.revokedAt
                    ? `Revoked · ${new Date(key.revokedAt).toLocaleString()}`
                    : 'Active'}
                </td>
                <td>{key.revokedAt ? '—' : 'Use revoke below'}</td>
              </tr>
            ))}
            {!status.keys.length && (
              <tr>
                <td colSpan={7}>No agent keys have been issued.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function AgentTab({
  baseUrl,
  token,
  workerId,
  authRecovery,
}: {
  baseUrl: string;
  token: string;
  workerId: string;
  authRecovery: AuthRecovery;
}) {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedAgentKey | null>(null);
  const [revoke, setRevoke] = useState<{ id: string; label: string } | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [mutationMessage, setMutationMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await loadAgentStatus(baseUrl, token, workerId, authRecovery));
      setError(null);
    } catch (cause) {
      setError(
        cause instanceof FleetAgentApiError && cause.status === 403
          ? 'Your role lacks fleet.view.'
          : errorMessage(cause),
      );
    }
  }, [baseUrl, token, workerId, authRecovery]);
  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);
  const create = async (event: import('react').FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCreating(true);
    setMutationMessage(null);
    try {
      setCreated(
        await createAgentKey(
          baseUrl,
          token,
          workerId,
          label.trim() || undefined,
          undefined,
          authRecovery,
        ),
      );
      setLabel('');
      await refreshStatus();
    } catch (cause) {
      setMutationMessage(agentKeyErrorMessage(cause));
    } finally {
      setCreating(false);
    }
  };
  const confirmRevoke = async () => {
    if (!revoke) return;
    setBusy(true);
    setRevokeError(null);
    try {
      const result = await revokeAgentKey(baseUrl, token, revoke.id, undefined, authRecovery);
      setRevoke(null);
      setMutationMessage(
        result.changed ? 'Key revoked.' : 'Key was already revoked; nothing changed.',
      );
      await refreshStatus();
      if (result.changed) requestAnimationFrame(() => createButtonRef.current?.focus());
    } catch (cause) {
      setRevokeError(agentKeyErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="agent-tab">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">BOX AGENT</span>
          <h2>Agent status & keys</h2>
        </div>
        <button type="button" className="button-secondary" onClick={() => void refreshStatus()}>
          Refresh status
        </button>
      </div>
      {error ? (
        <div className="permission-panel" role="alert">
          {error}
        </div>
      ) : status ? (
        <AgentStatusContent status={status} />
      ) : (
        <p aria-live="polite">Loading agent status…</p>
      )}
      {mutationMessage && (
        <div className="permission-panel" role="status">
          {mutationMessage}
        </div>
      )}
      <form className="agent-create-form" onSubmit={create}>
        <label>
          New key label (optional)
          <input
            maxLength={80}
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="e.g. gpu4 replacement"
          />
        </label>
        <button
          ref={createButtonRef}
          type="submit"
          className="button-secondary"
          disabled={creating}
        >
          {creating ? 'Creating…' : 'Create agent key'}
        </button>
        <small>
          Requires <code>fleet.operate</code> (SUPER_ADMIN only).
        </small>
      </form>
      {status && (
        <fieldset className="agent-revoke-buttons">
          <legend>Revoke active agent keys</legend>
          {status.keys
            .filter((key) => !key.revokedAt)
            .map((key) => (
              <button
                key={key.id}
                className="agent-revoke-trigger"
                type="button"
                onClick={() => {
                  setRevoke({ id: key.id, label: key.label });
                }}
              >
                Revoke {key.label}
              </button>
            ))}
        </fieldset>
      )}
      {created && (
        <AccessibleDialog
          title="Store this key now"
          onClose={() => setCreated(null)}
          returnFocusRef={createButtonRef}
        >
          <p>This key is shown once. Store it now.</p>
          <label>
            Plaintext agent key
            <input readOnly value={created.key} onFocus={(event) => event.currentTarget.select()} />
          </label>
          <button
            className="button-secondary"
            type="button"
            onClick={() =>
              void navigator.clipboard
                .writeText(created.key)
                .catch(() =>
                  setMutationMessage(
                    'Clipboard access was denied; select and copy the key manually.',
                  ),
                )
            }
          >
            Copy key
          </button>
          <p className="muted">Closing this dialog clears the key from memory.</p>
        </AccessibleDialog>
      )}
      {revoke && (
        <AccessibleDialog
          title="Revoke agent key?"
          onClose={() => {
            setRevoke(null);
            setRevokeError(null);
          }}
          returnFocusRef={createButtonRef}
        >
          <p>
            The agent using <strong>{revoke.label}</strong> stops being accepted immediately.
          </p>
          {revokeError && (
            <p className="permission-panel" role="alert">
              {revokeError}
            </p>
          )}
          <div className="dialog-actions">
            <button
              className="button-secondary"
              type="button"
              onClick={() => {
                setRevoke(null);
                setRevokeError(null);
              }}
            >
              Cancel
            </button>
            <button
              className="button-danger"
              type="button"
              disabled={busy}
              onClick={() => void confirmRevoke()}
            >
              {busy ? 'Revoking…' : 'Revoke key'}
            </button>
          </div>
        </AccessibleDialog>
      )}
    </section>
  );
}

function HardwareContent({
  view,
  dispatcherComfy,
}: {
  view: AgentTelemetryView;
  dispatcherComfy: FleetWorkerView['comfy'];
}) {
  const telemetry = view.telemetry;
  if (!telemetry) return <div className="panel empty">The agent has not reported.</div>;
  const observedAge = Math.max(
    0,
    view.generatedAt ? Date.parse(view.generatedAt) - telemetry.observedAt : 0,
  );
  const historical = view.stale;
  return (
    <div className={historical ? 'hardware-data is-historical' : 'hardware-data'}>
      {historical && (
        <div className="historical-banner">
          Historical — observed {ageLabel(Math.floor(observedAge / 1000))} before this response.
        </div>
      )}
      {view.clockSkewMs !== null && Math.abs(view.clockSkewMs) > 30_000 && (
        <div className="permission-panel">
          Agent clock differs from server by {view.clockSkewMs.toLocaleString()} ms.
        </div>
      )}
      <div className="hardware-gpu-grid">
        {telemetry.gpus.length ? (
          telemetry.gpus.map((gpu) => {
            const signal = view.signals.find((item) => item.index === gpu.index);
            const ratio = signal?.clockRatio ?? null;
            const thermal = signal?.thermalCollapseNow ?? null;
            return (
              <section className="panel hardware-gpu" key={gpu.index}>
                <div className="panel-heading">
                  <div>
                    <span className="eyebrow">GPU {gpu.index}</span>
                    <h3>{gpu.name ?? 'GPU name unknown'}</h3>
                  </div>
                  {thermal === true ? (
                    <span className="thermal-badge">Thermal collapse</span>
                  ) : thermal === null ? (
                    <span className="badge warning">Thermal state unknown</span>
                  ) : (
                    <span className="badge good">No collapse signal</span>
                  )}
                </div>
                {thermal === true && (
                  <div className="thermal-detail">
                    {shown(gpu.tempC, ' °C')} · SM clock{' '}
                    {shown(
                      gpu.smClockMhz,
                      ' / ' +
                        (gpu.smClockMaxMhz === null
                          ? 'No data'
                          : `${gpu.smClockMaxMhz.toLocaleString()} MHz`),
                    )}
                  </div>
                )}
                {thermal === null && <p className="muted">Unknown (inputs missing)</p>}
                <dl>
                  <dt>Temperature</dt>
                  <dd>{shown(gpu.tempC, ' °C')}</dd>
                  <dt>SM clock</dt>
                  <dd>
                    {gpu.smClockMhz === null
                      ? 'No data'
                      : `${gpu.smClockMhz.toLocaleString()} MHz / ${shown(gpu.smClockMaxMhz, ' MHz')}`}
                  </dd>
                  <dt>Clock ratio</dt>
                  <dd>
                    {ratio === null ? 'No data' : `${(ratio * 100).toFixed(1)}%`}
                    <div className="hardware-meter">
                      <i
                        style={{
                          width:
                            ratio === null ? '0%' : `${Math.max(0, Math.min(100, ratio * 100))}%`,
                        }}
                      />
                    </div>
                  </dd>
                  <dt>Power</dt>
                  <dd>
                    {gpu.powerW === null ? 'No data' : `${gpu.powerW} W`} /{' '}
                    {shown(gpu.powerLimitW, ' W')}
                  </dd>
                  <dt>GPU / memory utilization</dt>
                  <dd>
                    {shown(gpu.utilGpuPct, '%')} / {shown(gpu.utilMemPct, '%')}
                  </dd>
                  <dt>VRAM</dt>
                  <dd>
                    {shown(
                      gpu.vramUsedMib,
                      ' / ' +
                        (gpu.vramTotalMib === null
                          ? 'No data'
                          : `${gpu.vramTotalMib.toLocaleString()} MiB`),
                    )}
                    <small className="muted">Device-wide: may include other tenants.</small>
                  </dd>
                  <dt>Slowed since driver load</dt>
                  <dd>
                    {slowdownLabel(gpu)}
                    <small className="muted">
                      Cumulative driver counters; the throttle bitmask stays 0x0 on these cards.
                    </small>
                  </dd>
                  <dt>Foreign VRAM</dt>
                  <dd>
                    {signal?.foreignVramMib === null || signal?.foreignVramMib === undefined
                      ? 'Unknown (processes not visible)'
                      : `${signal.foreignVramMib.toLocaleString()} MiB`}
                    {signal?.foreignVramMib !== null && signal?.foreignVramMib !== undefined && (
                      <small className="muted">
                        Device VRAM not attributed to visible processes.
                      </small>
                    )}
                  </dd>
                </dl>
              </section>
            );
          })
        ) : (
          <div className="panel empty">No GPU data reported.</div>
        )}
      </div>
      <section className="panel hardware-processes">
        <h3>Compute processes</h3>
        {telemetry.computeApps.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>GPU</th>
                  <th>Name</th>
                  <th>VRAM</th>
                </tr>
              </thead>
              <tbody>
                {telemetry.computeApps.map((app) => (
                  <tr key={`${app.gpuIndex}-${app.name}-${app.vramMib ?? 'unknown'}`}>
                    <td>{app.gpuIndex}</td>
                    <td>{app.name}</td>
                    <td>{shown(app.vramMib, ' MiB')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>None visible — on a shared pod this does not mean idle.</p>
        )}
      </section>
      <div className="detail-grid hardware-host-grid">
        <section className="panel">
          <h3>Host</h3>
          <dl>
            <dt>RAM available / total</dt>
            <dd>
              {mib(telemetry.host.ramAvailMib)} / {mib(telemetry.host.ramTotalMib)}
            </dd>
            <dt>Swap used</dt>
            <dd>
              {mib(telemetry.host.swapUsedMib)}
              {telemetry.host.swapUsedMib !== null && telemetry.host.swapUsedMib > 0
                ? ' · swap in use'
                : ''}
            </dd>
            <dt>Load 1 / 5 / 15</dt>
            <dd>
              {shown(telemetry.host.load1)} / {shown(telemetry.host.load5)} /{' '}
              {shown(telemetry.host.load15)}
            </dd>
            <dt>Memory pressure</dt>
            <dd>{shown(telemetry.host.memPsiSome10, '%')}</dd>
            <dt>NTP</dt>
            <dd>
              {telemetry.host.ntpSynced === null
                ? 'Unknown'
                : telemetry.host.ntpSynced
                  ? 'Synced'
                  : 'Not synced'}
            </dd>
            <dt>Uptime</dt>
            <dd>
              {telemetry.host.uptimeSec === null
                ? 'No data'
                : `${Math.floor(telemetry.host.uptimeSec / 86400)} d ${Math.floor((telemetry.host.uptimeSec % 86400) / 3600)} h`}
            </dd>
          </dl>
        </section>
        <section className="panel">
          <h3>Disks</h3>
          {telemetry.host.disks.length ? (
            telemetry.host.disks.map((disk) => (
              <dl key={disk.mount}>
                <dt>Mount</dt>
                <dd>{disk.mount}</dd>
                <dt>Used / total</dt>
                <dd>
                  {disk.usedGb === null
                    ? 'No data'
                    : `${disk.usedGb} / ${shown(disk.totalGb, ' GB')}`}
                </dd>
                <dt>Inodes used</dt>
                <dd>{shown(disk.inodeUsedPct, '%')}</dd>
              </dl>
            ))
          ) : (
            <p>No disk data reported.</p>
          )}
        </section>
        <section className="panel">
          <h3>Services</h3>
          {telemetry.services.length ? (
            telemetry.services.map((service) => (
              <div className="hardware-service" key={service.name}>
                <strong>{service.name}</strong>
                <span>
                  {service.active}
                  {service.sub ? ` · ${service.sub}` : ''}
                </span>
                <small>Restarts: {shown(service.restarts)}</small>
              </div>
            ))
          ) : (
            <p>No services reported.</p>
          )}
        </section>
        <section className="panel">
          <h3>ComfyUI · agent view</h3>
          {telemetry.comfy.map((instance) => {
            const match = dispatcherComfy;
            const differs =
              (instance.running !== null &&
                match.running !== null &&
                instance.running !== match.running) ||
              (instance.pending !== null &&
                match.pending !== null &&
                instance.pending !== match.pending);
            return (
              <div className="hardware-service" key={instance.instance}>
                <strong>{instance.instance}</strong>
                <span>
                  {instance.reachable === null
                    ? 'Reachability unknown'
                    : instance.reachable
                      ? 'Reachable'
                      : 'Unreachable'}{' '}
                  · {shown(instance.running)} running · {shown(instance.pending)} pending
                </span>
                <small>
                  Dispatcher view: {shown(match.running)} running · {shown(match.pending)} pending
                </small>
                {differs && <b className="text-warning">Views disagree</b>}
              </div>
            );
          })}
          {!telemetry.comfy.length && <p>No ComfyUI instance data reported.</p>}
        </section>
      </div>
      <section className="panel hardware-logs">
        <h3>ComfyUI errors, last 30 minutes</h3>
        {telemetry.logs.some((log) => log.lines.length) ? (
          telemetry.logs.map((log) => (
            <div key={log.unit}>
              <small className="muted">{log.unit}</small>
              <pre className="log-lines">{log.lines.join('\n')}</pre>
            </div>
          ))
        ) : (
          <p>No error lines reported.</p>
        )}
      </section>
    </div>
  );
}

export function HardwareTab({
  baseUrl,
  token,
  workerId,
  dispatcherComfy,
  authRecovery,
  incidents,
  onOpenIncidents,
}: {
  baseUrl: string;
  token: string;
  workerId: string;
  dispatcherComfy: FleetWorkerView['comfy'];
  authRecovery: AuthRecovery;
  incidents?: { critical: number; warning: number; info: number };
  onOpenIncidents?: () => void;
}) {
  const [view, setView] = useState<AgentTelemetryView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  // StrictMode runs effect -> cleanup -> effect on mount, so the flag must be re-armed here.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const load = useCallback(async () => {
    try {
      const next = await loadAgentTelemetry(baseUrl, token, workerId, undefined, authRecovery);
      if (next.workerId !== workerId) throw new Error('Telemetry response worker ID mismatch.');
      if (!mounted.current) return;
      setView(next);
      setError(null);
    } catch (cause) {
      if (!mounted.current) return;
      setError(
        cause instanceof FleetAgentApiError && cause.status === 403
          ? 'Your role lacks fleet.view.'
          : errorMessage(cause),
      );
    }
  }, [baseUrl, token, workerId, authRecovery]);
  useEffect(() => {
    let active = true;
    const poll = async () => {
      if (!active) return;
      await load();
    };
    void poll();
    const timer = window.setInterval(poll, 15_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [load]);
  return (
    <section className="hardware-tab">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">AGENT-REPORTED HARDWARE</span>
          <h2>Hardware & telemetry</h2>
        </div>
        <button className="button-secondary" type="button" onClick={() => void load()}>
          Refresh
        </button>
      </div>
      {incidents && incidents.critical + incidents.warning + incidents.info > 0 && (
        <p className="hardware-incidents" role="status">
          <b>
            {incidents.critical} critical · {incidents.warning} warning · {incidents.info} info
          </b>{' '}
          open for this worker.{' '}
          {onOpenIncidents && (
            <button type="button" className="link-button" onClick={onOpenIncidents}>
              View incidents
            </button>
          )}
        </p>
      )}
      {error ? (
        <div className="permission-panel" role="alert">
          {error}
        </div>
      ) : view ? (
        <HardwareContent view={view} dispatcherComfy={dispatcherComfy} />
      ) : (
        <p aria-live="polite">Loading hardware telemetry…</p>
      )}
      <MetricsCharts
        baseUrl={baseUrl}
        token={token}
        workerId={workerId}
        authRecovery={authRecovery}
      />
    </section>
  );
}

export function DevStateGallery() {
  if (!import.meta.env.DEV) return null;
  const fixtures = import.meta.glob('../../../docs/fleet-contracts/agent-*.json', {
    eager: true,
    import: 'default',
  }) as Record<string, unknown>;
  const entries = Object.entries(fixtures).sort(([a], [b]) => a.localeCompare(b));
  const statusFiles = entries.filter(([name]) => name.includes('agent-status.'));
  const telemetryFiles = entries.filter(([name]) => name.includes('agent-telemetry.'));
  const keyCreated = entries.find(([name]) => name.endsWith('agent-key-created.json'))?.[1];
  const connected = parseAgentStatus(
    statusFiles.find(([name]) => name.includes('connected.'))?.[1],
  );
  const never = parseAgentStatus(
    statusFiles.find(([name]) => name.includes('never-connected.'))?.[1],
  );
  return (
    <main className="dev-gallery">
      <header>
        <span className="eyebrow">DEVELOPMENT ONLY</span>
        <h1>Agent & hardware state gallery</h1>
      </header>
      <div className="synthetic-banner">SYNTHETIC FIXTURES - not live data</div>
      <section className="panel">
        <h2>Agent status · {statusFiles.length} fixtures</h2>
        <div className="gallery-status-grid">
          {statusFiles.map(([path, raw]) => {
            const status = parseAgentStatus(raw);
            return (
              <article className="panel" key={path}>
                <h3>{path.split('.').slice(-2).join('.').replace('.json', '')}</h3>
                <AgentStatusContent status={status} />
              </article>
            );
          })}
        </div>
      </section>
      <section className="panel">
        <h2>Key creation response</h2>
        {keyCreated ? (
          <div className="gallery-key">
            <span>{parseCreatedAgentKey(keyCreated).keyPrefix}</span>
            <small>Plaintext shown here only because this is synthetic development data.</small>
          </div>
        ) : (
          <p>Fixture missing.</p>
        )}
      </section>
      <section className="panel">
        <h2>Hardware telemetry · {telemetryFiles.length} fixtures</h2>
        <div className="gallery-hardware-grid">
          {telemetryFiles.map(([path, raw]) => {
            const view = parseAgentTelemetryView(raw);
            const status = view.telemetry ? connected : never;
            return (
              <article className="panel" key={path}>
                <h3>{path.split('.').slice(-2).join('.').replace('.json', '')}</h3>
                <AgentStatusContent status={{ ...status, workerId: view.workerId }} />
                <HardwareContent
                  view={view}
                  dispatcherComfy={{ reachable: null, running: null, pending: null }}
                />
              </article>
            );
          })}
        </div>
      </section>
      <button
        className="button-secondary"
        type="button"
        onClick={() => {
          window.location.hash = '';
        }}
      >
        Close gallery
      </button>
    </main>
  );
}
