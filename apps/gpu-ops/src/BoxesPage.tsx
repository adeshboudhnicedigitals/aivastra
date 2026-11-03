import { useCallback, useEffect, useRef, useState } from 'react';
import { HardwareTab } from './AgentPanels';
import type { AuthRecovery } from './auth';
import { FleetAgentApiError } from './live-agent';
import {
  type BoxDispatcherState,
  type BoxHealth,
  boxHealth,
  type CreatedEnrollToken,
  createEnrollToken,
  DISK_WARN_PCT,
  type EnrollToken,
  type FleetBox,
  loadBoxes,
  loadEnrollTokens,
  revokeEnrollToken,
  TEMP_WARN_C,
} from './live-boxes';

// The home page: every rented GPU box, as its own agent sees it. The dispatcher appears only as a
// label, so disabling a worker never makes a healthy box look dead (or a dead one look fine).

const REFRESH_MS = 15_000;
const UNKNOWN_DISPATCHER = { reachable: null, running: null, pending: null };

const HEALTH: Record<BoxHealth, { text: string; tone: string; hint: string }> = {
  ok: { text: 'OK', tone: 'good', hint: 'Agent reporting; nothing needs attention.' },
  warn: {
    text: 'Attention',
    tone: 'warning',
    hint: `Disk ≥ ${DISK_WARN_PCT}%, GPU ≥ ${TEMP_WARN_C} °C, or an open incident.`,
  },
  down: {
    text: 'ComfyUI down',
    tone: 'danger',
    hint: 'The box is up but ComfyUI does not answer.',
  },
  silent: {
    text: 'No data',
    tone: 'danger',
    hint: 'The agent has not reported in the last minute: box down, network, or agent stopped.',
  },
  not_enrolled: {
    text: 'No agent',
    tone: 'neutral',
    hint: 'No working agent key. Run fleet-converge.sh --apply --agent for this box.',
  },
};
const DISPATCHER: Record<BoxDispatcherState, { text: string; tone: string; hint: string }> = {
  in_rotation: { text: 'In rotation', tone: 'blue', hint: 'The dispatcher sends jobs here.' },
  not_reachable: {
    text: "Dispatcher can't reach",
    tone: 'warning',
    hint: 'The worker is enabled but the dispatcher’s last probe of ComfyUI failed.',
  },
  disabled: { text: 'Disabled', tone: 'neutral', hint: 'Worker is disabled in the admin panel.' },
  not_a_worker: {
    text: 'Not a worker',
    tone: 'neutral',
    hint: 'No dispatcher worker uses this box.',
  },
};

const gb = (mib: number | null) => (mib === null ? '—' : `${Math.round(mib / 1024)} GB`);
const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v)}%`);
function ago(iso: string | null, now: number): string {
  if (!iso) return 'never';
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 172_800) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
function gpuText(b: FleetBox): string {
  const gpus = b.hardware?.gpus ?? [];
  if (gpus.length === 0) return '—';
  const names = [...new Set(gpus.map((g) => (g.name ?? 'GPU').replace(/^NVIDIA /, '')))];
  return gpus.length === 1 ? (names[0] ?? 'GPU') : `${gpus.length}× ${names.join(' / ')}`;
}
function vramText(b: FleetBox): string {
  const gpus = b.hardware?.gpus ?? [];
  if (gpus.length === 0 || gpus.some((g) => g.vramTotalMib === null)) return '—';
  return gb(gpus.reduce((sum, g) => sum + (g.vramTotalMib ?? 0), 0));
}
const errorText = (cause: unknown) =>
  cause instanceof FleetAgentApiError && cause.status === 403
    ? 'Your role cannot see the fleet (needs fleet.view).'
    : cause instanceof Error
      ? cause.message
      : 'Could not load the boxes.';

function readBoxParam(): string | null {
  return new URLSearchParams(window.location.search).get('box');
}
function writeBoxParam(id: string | null) {
  const params = new URLSearchParams(window.location.search);
  if (id) params.set('box', id);
  else params.delete('box');
  window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
}

export function BoxesPage({
  baseUrl,
  token,
  authRecovery,
  autoRefresh,
  onOpenIncidents,
  onOpenJobs,
}: {
  baseUrl: string;
  token: string;
  authRecovery: AuthRecovery;
  autoRefresh: boolean;
  onOpenIncidents: (boxId: string) => void;
  onOpenJobs: (workerId: string) => void;
}) {
  const [boxes, setBoxes] = useState<FleetBox[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [selected, setSelected] = useState<string | null>(readBoxParam);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const load = useCallback(async () => {
    try {
      const data = await loadBoxes(baseUrl, token, authRecovery);
      if (!mounted.current) return;
      setBoxes(data.boxes);
      setNow(Date.parse(data.generatedAt) || Date.now());
      setError(null);
    } catch (cause) {
      if (mounted.current) setError(errorText(cause));
    }
  }, [baseUrl, token, authRecovery]);
  useEffect(() => {
    void load();
    if (!autoRefresh) return;
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load, autoRefresh]);
  const select = (id: string | null) => {
    setSelected(id);
    writeBoxParam(id);
  };

  const box = boxes?.find((b) => b.id === selected) ?? null;
  if (box) {
    return (
      <BoxDetail
        box={box}
        now={now}
        baseUrl={baseUrl}
        token={token}
        authRecovery={authRecovery}
        onBack={() => select(null)}
        onOpenIncidents={() => onOpenIncidents(box.id)}
        onOpenJobs={box.workerId ? () => onOpenJobs(box.workerId as string) : undefined}
      />
    );
  }

  const counts = { ok: 0, attention: 0, nodata: 0 };
  for (const b of boxes ?? []) {
    const h = boxHealth(b);
    if (h === 'ok') counts.ok++;
    else if (h === 'warn' || h === 'down') counts.attention++;
    else counts.nodata++;
  }

  return (
    <section className="boxes-page" aria-label="Boxes">
      {error && (
        <p className="panel empty" role="alert">
          {error}
        </p>
      )}
      {boxes === null && !error && <p className="muted">Loading boxes…</p>}
      {boxes && boxes.length === 0 && (
        <div className="panel empty">
          <h3>No boxes yet</h3>
          <p>
            Boxes appear here when vps-sync enrols them. Create an enrolment token below once, then
            run <code className="mono">bash fleet-converge.sh --apply --agent w1 w2 …</code>
          </p>
        </div>
      )}
      {boxes && boxes.length > 0 && (
        <>
          <section className="boxes-counts" aria-label="Summary">
            <span className="badge good">{counts.ok} OK</span>
            <span className={`badge ${counts.attention ? 'warning' : 'neutral'}`}>
              {counts.attention} need attention
            </span>
            <span className={`badge ${counts.nodata ? 'danger' : 'neutral'}`}>
              {counts.nodata} no data / no agent
            </span>
          </section>
          <div className="table-wrap">
            <table className="boxes-table">
              <thead>
                <tr>
                  <th scope="col">Box</th>
                  <th scope="col">Health</th>
                  <th scope="col">GPU</th>
                  <th scope="col">VRAM</th>
                  <th scope="col">GPU now</th>
                  <th scope="col">Temp</th>
                  <th scope="col">Disk</th>
                  <th scope="col">RAM free</th>
                  <th scope="col">ComfyUI</th>
                  <th scope="col">Agent</th>
                  <th scope="col">Dispatcher</th>
                  <th scope="col">Jobs 24h</th>
                </tr>
              </thead>
              <tbody>
                {boxes.map((b) => {
                  const h = HEALTH[boxHealth(b)];
                  const d = DISPATCHER[b.dispatcher];
                  const t = b.telemetry && !b.telemetry.stale ? b.telemetry : null;
                  const disk = t?.diskUsedPctMax ?? null;
                  const temp = t?.tempMaxC ?? null;
                  return (
                    <tr key={b.id}>
                      <th scope="row">
                        <button
                          type="button"
                          className="text-link mono"
                          onClick={() => select(b.id)}
                          aria-label={`Open ${b.label}`}
                        >
                          {b.label}
                        </button>
                      </th>
                      <td data-label="Health">
                        <span className={`badge ${h.tone}`} title={h.hint}>
                          {h.text}
                        </span>
                      </td>
                      <td data-label="GPU">{gpuText(b)}</td>
                      <td data-label="VRAM">{vramText(b)}</td>
                      <td data-label="GPU now">{pct(t?.utilGpuPctMax ?? null)}</td>
                      <td
                        data-label="Temp"
                        className={temp !== null && temp >= TEMP_WARN_C ? 'boxes-warn' : ''}
                      >
                        {temp === null ? '—' : `${Math.round(temp)} °C`}
                      </td>
                      <td
                        data-label="Disk"
                        className={disk !== null && disk >= DISK_WARN_PCT ? 'boxes-warn' : ''}
                      >
                        {pct(disk)}
                      </td>
                      <td data-label="RAM free">{gb(t?.ramAvailMib ?? null)}</td>
                      <td data-label="ComfyUI">
                        {!t?.comfy
                          ? '—'
                          : t.comfy.reachable === false
                            ? 'down'
                            : t.comfy.reachable
                              ? `up · ${t.comfy.running ?? '?'} run / ${t.comfy.pending ?? '?'} queued`
                              : '—'}
                      </td>
                      <td
                        data-label="Agent"
                        title={b.agentVersion ? `agent ${b.agentVersion}` : undefined}
                      >
                        {ago(b.heartbeatAt ?? b.lastSeenAt, now)}
                      </td>
                      <td data-label="Dispatcher">
                        <span className={`badge ${d.tone}`} title={d.hint}>
                          {d.text}
                        </span>
                      </td>
                      <td data-label="Jobs 24h">
                        {b.jobs24h
                          ? `${b.jobs24h.completed}${b.jobs24h.failed ? ` · ${b.jobs24h.failed} failed` : ''}`
                          : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      <EnrollTokens baseUrl={baseUrl} token={token} authRecovery={authRecovery} />
    </section>
  );
}

function BoxDetail({
  box,
  now,
  baseUrl,
  token,
  authRecovery,
  onBack,
  onOpenIncidents,
  onOpenJobs,
}: {
  box: FleetBox;
  now: number;
  baseUrl: string;
  token: string;
  authRecovery: AuthRecovery;
  onBack: () => void;
  onOpenIncidents: () => void;
  onOpenJobs?: () => void;
}) {
  const h = HEALTH[boxHealth(box)];
  const d = DISPATCHER[box.dispatcher];
  const hw = box.hardware;
  return (
    <section className="boxes-page" aria-labelledby="box-title">
      <button type="button" className="button-secondary" onClick={onBack}>
        ← All boxes
      </button>
      <div className="live-intro">
        <span className="eyebrow">BOX</span>
        <h2 id="box-title">{box.label}</h2>
        <p>
          <span className={`badge ${h.tone}`} title={h.hint}>
            {h.text}
          </span>{' '}
          <span className={`badge ${d.tone}`} title={d.hint}>
            {d.text}
            {box.workerId ? ` · ${box.workerId}` : ''}
          </span>
        </p>
      </div>
      <div className="panel boxes-facts">
        <dl>
          <dt>GPU</dt>
          <dd>
            {hw && hw.gpus.length > 0
              ? hw.gpus
                  .map((g) => `${g.index}: ${g.name ?? 'GPU'} (${gb(g.vramTotalMib)})`)
                  .join(', ')
              : '—'}
          </dd>
          <dt>Driver</dt>
          <dd>{hw?.driverVersion ?? '—'}</dd>
          <dt>CPU / RAM</dt>
          <dd>
            {hw?.cpuCount ?? '—'} cores · {gb(hw?.ramTotalMib ?? null)}
          </dd>
          <dt>Disk</dt>
          <dd>{hw?.diskTotalGb == null ? '—' : `${hw.diskTotalGb} GB`}</dd>
          <dt>Agent</dt>
          <dd>
            {box.agentEnrolled ? (box.agentVersion ? `v${box.agentVersion}` : 'enrolled') : 'none'}{' '}
            · last report {ago(box.heartbeatAt ?? box.lastSeenAt, now)}
          </dd>
          {box.jobs24h && (
            <>
              <dt>Jobs 24h</dt>
              <dd>
                {box.jobs24h.completed} completed, {box.jobs24h.failed} failed
                {onOpenJobs && (
                  <>
                    {' · '}
                    <button type="button" className="text-link" onClick={onOpenJobs}>
                      open jobs
                    </button>
                  </>
                )}
              </dd>
            </>
          )}
        </dl>
        {hw === null && (
          <p className="muted">
            Hardware appears after the agent’s first report.
            {box.agentEnrolled ? '' : ' This box has no agent yet.'}
          </p>
        )}
      </div>
      {box.agentEnrolled && (
        <HardwareTab
          baseUrl={baseUrl}
          token={token}
          workerId={box.id}
          dispatcherComfy={UNKNOWN_DISPATCHER}
          authRecovery={authRecovery}
          incidents={box.incidents}
          onOpenIncidents={onOpenIncidents}
        />
      )}
    </section>
  );
}

/** One-time setup: the token vps-sync uses to enrol boxes. Shown once, then only its prefix. */
function EnrollTokens({
  baseUrl,
  token,
  authRecovery,
}: {
  baseUrl: string;
  token: string;
  authRecovery: AuthRecovery;
}) {
  const [tokens, setTokens] = useState<EnrollToken[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedEnrollToken | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const refresh = useCallback(async () => {
    try {
      setTokens(await loadEnrollTokens(baseUrl, token, authRecovery));
      setError(null);
    } catch (cause) {
      setError(errorText(cause));
    }
  }, [baseUrl, token, authRecovery]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const create = async () => {
    setBusy(true);
    try {
      setCreated(await createEnrollToken(baseUrl, token, 'vps-sync', authRecovery));
      setCopied(false);
      await refresh();
    } catch (cause) {
      setError(
        cause instanceof FleetAgentApiError && cause.status === 403
          ? 'Only a SUPER_ADMIN can create an enrolment token.'
          : errorText(cause),
      );
    } finally {
      setBusy(false);
    }
  };
  const revoke = async (id: string) => {
    if (!window.confirm('Revoke this token? vps-sync will not be able to enrol boxes with it.'))
      return;
    setBusy(true);
    try {
      await revokeEnrollToken(baseUrl, token, id, authRecovery);
      await refresh();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };
  const active = (tokens ?? []).filter((t) => !t.revokedAt);
  return (
    <details className="panel boxes-setup" open={active.length === 0 || created !== null}>
      <summary>
        <h3 className="section-title">Setup: enrolment token</h3>
        <span className={`badge ${active.length ? 'good' : 'warning'}`}>
          {active.length ? 'set up' : 'not set up'}
        </span>
      </summary>
      <p>
        vps-sync uses this token to add a box here and give it its agent key automatically. You
        create it once; no per-box keys.
      </p>
      {error && (
        <p className="process-feedback" role="alert">
          {error}
        </p>
      )}
      {created && (
        <div className="boxes-token" role="status">
          <p>
            <strong>Copy this token now: it is shown only once.</strong>
          </p>
          <code className="mono">{created.token}</code>{' '}
          <button
            type="button"
            className="button-secondary"
            onClick={() => {
              void navigator.clipboard
                ?.writeText(created.token)
                .then(() => setCopied(true))
                .catch(() => setCopied(false));
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
          <p>
            Then in a terminal on your machine run{' '}
            <code className="mono">
              bash ~/Projects/vps-sync/fleet-converge.sh --set-enroll-token
            </code>{' '}
            and paste it.
          </p>
        </div>
      )}
      {tokens && tokens.length > 0 && (
        <ul className="boxes-token-list">
          {tokens.map((t) => (
            <li key={t.id}>
              <span className="mono">{t.tokenPrefix}…</span> {t.label && `(${t.label})`} · created{' '}
              {new Date(t.createdAt).toLocaleDateString()} · last used{' '}
              {t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString() : 'never'}
              {t.revokedAt ? (
                <span className="badge neutral">revoked</span>
              ) : (
                <button
                  type="button"
                  className="text-link"
                  disabled={busy}
                  onClick={() => void revoke(t.id)}
                >
                  revoke
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        className="button-secondary"
        disabled={busy}
        onClick={() => void create()}
      >
        {active.length ? 'Create a new token' : 'Create enrolment token'}
      </button>
    </details>
  );
}
