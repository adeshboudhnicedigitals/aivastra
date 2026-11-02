import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibleDialog } from './AccessibleDialog';
import type { AuthRecovery } from './auth';
import {
  type AlertRule,
  type AlertRulePatch,
  type AlertRules,
  acknowledgeIncident,
  addIncidentNote,
  type FleetIncident,
  type IncidentDetail,
  type IncidentFilters,
  type IncidentSeverity,
  type IncidentState,
  incidentErrorMessage,
  loadAlertRules,
  loadIncident,
  loadIncidents,
  parseAlertRules,
  parseIncidentDetail,
  parseIncidentList,
  parseIncidentSummary,
  patchAlertRule,
} from './live-incidents';

const STATE_OPTIONS: (IncidentState | '')[] = ['', 'OPEN', 'ACK', 'RECOVERED'];
const SEVERITY_OPTIONS: (IncidentSeverity | '')[] = ['', 'critical', 'warning', 'info'];
const RULE_OPTIONS = [
  '',
  'agent_silent',
  'comfy_down_box_up',
  'box_unreachable',
  'thermal_collapse',
  'gpu_temp_high',
  'disk_high',
  'swap_active',
  'ram_low',
  'foreign_vram',
  'clock_skew',
  'ingest_rejected',
];
const PAGE_SIZE = 25;
const formatDate = (value: string) => new Date(value).toLocaleString();
const displayScalar = (value: string | number | boolean | null) =>
  value === null ? 'Unknown' : typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value);

function FilterPicker<T extends string>({
  label,
  value,
  options,
  describe,
  onChange,
}: {
  label: string;
  value: T;
  options: T[];
  describe: (value: T) => string;
  onChange: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="incident-filter-picker">
      <span>{label}</span>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((state) => !state)}
      >
        {describe(value)} <span aria-hidden="true">⌄</span>
      </button>
      {open && (
        <div role="listbox" aria-label={label} className="incident-filter-options">
          {options.map((option) => (
            <button
              type="button"
              role="option"
              aria-selected={option === value}
              key={option || 'all'}
              onClick={() => {
                onChange(option);
                setOpen(false);
              }}
            >
              {describe(option)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function EvidenceRows({ evidence }: { evidence: FleetIncident['evidence'] }) {
  const entries = Object.entries(evidence);
  return entries.length ? (
    <dl className="incident-evidence">
      {entries.map(([key, value]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>{displayScalar(value)}</dd>
        </div>
      ))}
    </dl>
  ) : (
    <p className="muted">No evidence fields were recorded.</p>
  );
}

function Timeline({ detail }: { detail: IncidentDetail }) {
  return (
    <ol className="incident-timeline">
      {detail.events.map((event) => (
        <li key={event.id}>
          <span className="incident-timeline-marker" aria-hidden="true" />
          <div>
            <div className="panel-heading">
              <strong>{event.kind}</strong>
              <time dateTime={event.at}>{formatDate(event.at)}</time>
            </div>
            <small>
              {event.actor ? (event.actor.email ?? `Admin ${event.actor.id}`) : 'System'}
            </small>
            {event.text && <p>{event.text}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function LiveIncidentsPage({
  baseUrl,
  token,
  authRecovery,
  initialWorkerId,
  onOpenRules,
}: {
  baseUrl: string;
  token: string;
  authRecovery: AuthRecovery;
  initialWorkerId: string;
  onOpenRules: () => void;
}) {
  const [state, setState] = useState<IncidentState | ''>('');
  const [severity, setSeverity] = useState<IncidentSeverity | ''>('');
  const [ruleKey, setRuleKey] = useState('');
  const [workerDraft, setWorkerDraft] = useState(initialWorkerId);
  const [filters, setFilters] = useState<IncidentFilters>({
    limit: PAGE_SIZE,
    offset: 0,
    ...(initialWorkerId ? { workerId: initialWorkerId } : {}),
  });
  const [pageData, setPageData] = useState<ReturnType<typeof parseIncidentList> | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<IncidentDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [ackNote, setAckNote] = useState('');
  const [newNote, setNewNote] = useState('');
  const [busy, setBusy] = useState(false);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const refreshList = useCallback(async () => {
    setLoading(true);
    try {
      const result = await loadIncidents(baseUrl, token, filters, { recovery: authRecovery });
      setPageData(result);
      setListError(null);
    } catch (cause) {
      setPageData(null);
      setListError(incidentErrorMessage(cause, 'view'));
    } finally {
      setLoading(false);
    }
  }, [baseUrl, token, filters, authRecovery]);
  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  const refreshDetail = useCallback(
    async (id: string) => {
      try {
        setDetail(await loadIncident(baseUrl, token, id, { recovery: authRecovery }));
        setDetailError(null);
      } catch (cause) {
        setDetail(null);
        setDetailError(incidentErrorMessage(cause, 'view'));
      }
    },
    [baseUrl, token, authRecovery],
  );
  useEffect(() => {
    if (detailId) void refreshDetail(detailId);
    else setDetail(null);
  }, [detailId, refreshDetail]);

  const applyFilters = (event: import('react').FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFilters({
      state: state ? [state] : undefined,
      severity: severity || undefined,
      ruleKey: ruleKey || undefined,
      workerId: workerDraft.trim() || undefined,
      limit: PAGE_SIZE,
      offset: 0,
    });
  };
  const selectIncident = (incident: FleetIncident, trigger: HTMLButtonElement) => {
    returnFocusRef.current = trigger;
    setActionMessage(null);
    setAckNote('');
    setNewNote('');
    setDetailId(incident.id);
  };
  const acknowledge = async (event: import('react').FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      !detail ||
      ackNote.trim().length === 1 ||
      ackNote.trim().length === 2 ||
      ackNote.trim().length > 1000
    )
      return;
    setBusy(true);
    setActionMessage(null);
    try {
      const result = await acknowledgeIncident(baseUrl, token, detail.incident.id, ackNote, {
        recovery: authRecovery,
      });
      setActionMessage(
        result.changed
          ? 'Incident acknowledged.'
          : 'Already acknowledged or recovered; nothing changed.',
      );
      setAckNote('');
      await Promise.all([refreshDetail(detail.incident.id), refreshList()]);
    } catch (cause) {
      setActionMessage(incidentErrorMessage(cause, 'ack'));
    } finally {
      setBusy(false);
    }
  };
  const addNote = async (event: import('react').FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!detail || newNote.trim().length < 3 || newNote.trim().length > 1000) return;
    setBusy(true);
    setActionMessage(null);
    try {
      await addIncidentNote(baseUrl, token, detail.incident.id, newNote, {
        recovery: authRecovery,
      });
      setActionMessage('Note added.');
      setNewNote('');
      await refreshDetail(detail.incident.id);
    } catch (cause) {
      setActionMessage(incidentErrorMessage(cause, 'ack'));
    } finally {
      setBusy(false);
    }
  };

  const items = pageData?.items ?? [];
  const total = pageData?.total ?? 0;
  const offset = filters.offset ?? 0;
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + PAGE_SIZE, total);
  return (
    <section className="incidents-page">
      <div className="live-intro incidents-intro">
        <div>
          <span className="eyebrow">FLEET SIGNALS</span>
          <h2>Incidents</h2>
          <p>
            Recorded conditions from the fleet evaluator. An empty list means nothing has been
            recorded.
          </p>
        </div>
        <button className="button-secondary" type="button" onClick={onOpenRules}>
          Alert rules
        </button>
      </div>
      <form className="incident-filter-bar" onSubmit={applyFilters}>
        <FilterPicker
          label="State"
          value={state}
          options={STATE_OPTIONS}
          describe={(value) => value || 'Any state'}
          onChange={setState}
        />
        <FilterPicker
          label="Severity"
          value={severity}
          options={SEVERITY_OPTIONS}
          describe={(value) => value || 'Any severity'}
          onChange={setSeverity}
        />
        <FilterPicker
          label="Rule"
          value={ruleKey}
          options={RULE_OPTIONS}
          describe={(value) => value || 'Any rule'}
          onChange={setRuleKey}
        />
        <label className="incident-worker-filter">
          Worker ID
          <input
            value={workerDraft}
            onChange={(event) => setWorkerDraft(event.target.value)}
            maxLength={100}
            placeholder="Any worker"
          />
        </label>
        <button className="button-secondary" type="submit">
          Apply filters
        </button>
      </form>
      {listError && (
        <div className="permission-panel" role="alert">
          {listError}
        </div>
      )}
      <div className="incident-list-heading">
        <span>
          {loading
            ? 'Loading recorded incidents…'
            : pageData
              ? `${from}–${to} of ${total} recorded`
              : 'Incident list unavailable'}
        </span>
        <button
          className="link-button"
          type="button"
          onClick={() => void refreshList()}
          disabled={loading}
        >
          Refresh list
        </button>
      </div>
      {pageData && items.length === 0 && (
        <div className="panel incident-empty">
          <span className="eyebrow">NO RECORDED EVENTS</span>
          <h3>No incidents recorded</h3>
          <p>
            The evaluator and GPU box agents are not live yet. No recorded incidents does not
            establish that the fleet is healthy.
          </p>
        </div>
      )}
      {items.length > 0 && (
        <div className="table-wrap incident-table-wrap">
          <table className="incident-table">
            <thead>
              <tr>
                <th>Severity</th>
                <th>State</th>
                <th>Worker</th>
                <th>Rule</th>
                <th>Summary</th>
                <th>Opened</th>
                <th>
                  <span className="sr-only">Detail</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((incident) => (
                <tr key={incident.id}>
                  <td>
                    <span className={`incident-severity is-${incident.severity}`}>
                      {incident.severity}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`badge ${incident.state === 'OPEN' ? 'danger' : incident.state === 'ACK' ? 'warning' : ''}`}
                    >
                      {incident.state}
                    </span>
                  </td>
                  <td className="mono">{incident.workerId}</td>
                  <td className="mono">{incident.ruleKey}</td>
                  <td>{incident.summary}</td>
                  <td>{formatDate(incident.openedAt)}</td>
                  <td>
                    <button
                      type="button"
                      className="text-link"
                      onClick={(event) => selectIncident(incident, event.currentTarget)}
                    >
                      Details
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pageData && total > PAGE_SIZE && (
        <div className="incident-pagination">
          <button
            className="button-secondary"
            type="button"
            disabled={filters.offset === 0 || loading}
            onClick={() =>
              setFilters((current) => ({
                ...current,
                offset: Math.max(0, (current.offset ?? 0) - PAGE_SIZE),
              }))
            }
          >
            Previous
          </button>
          <span>
            Page {Math.floor(offset / PAGE_SIZE) + 1} of {Math.ceil(total / PAGE_SIZE)}
          </span>
          <button
            className="button-secondary"
            type="button"
            disabled={offset + PAGE_SIZE >= total || loading}
            onClick={() =>
              setFilters((current) => ({ ...current, offset: (current.offset ?? 0) + PAGE_SIZE }))
            }
          >
            Next
          </button>
        </div>
      )}
      {detailId && (
        <AccessibleDialog
          title={
            detail ? `${detail.incident.ruleKey} · ${detail.incident.workerId}` : 'Incident detail'
          }
          onClose={() => setDetailId(null)}
          returnFocusRef={returnFocusRef}
        >
          {detailError ? (
            <div className="permission-panel" role="alert">
              {detailError}
            </div>
          ) : detail ? (
            <>
              <div className="incident-detail-summary">
                <span className={`incident-severity is-${detail.incident.severity}`}>
                  {detail.incident.severity}
                </span>
                <span className="badge">{detail.incident.state}</span>
                <p>{detail.incident.summary}</p>
                <small>
                  Opened {formatDate(detail.incident.openedAt)} · Detail snapshot{' '}
                  {formatDate(detail.generatedAt)}
                </small>
              </div>
              <h3>Evidence at opening</h3>
              <EvidenceRows evidence={detail.incident.evidence} />
              <h3>Timeline</h3>
              <Timeline detail={detail} />
              {actionMessage && (
                <p className="permission-panel" role="status">
                  {actionMessage}
                </p>
              )}
              {detail.incident.state === 'OPEN' && (
                <form className="incident-action-form" onSubmit={acknowledge}>
                  <label>
                    Acknowledge note (optional)
                    <textarea
                      value={ackNote}
                      onChange={(event) => setAckNote(event.target.value)}
                      maxLength={1000}
                      placeholder="Add context for the next operator"
                    />
                  </label>
                  <small>{ackNote.trim().length} / 1000 characters. If provided, use 3–1000.</small>
                  <button
                    className="button-secondary"
                    type="submit"
                    disabled={busy || (ackNote.trim().length > 0 && ackNote.trim().length < 3)}
                  >
                    {busy ? 'Saving…' : 'Acknowledge incident'}
                  </button>
                </form>
              )}
              <form className="incident-action-form" onSubmit={addNote}>
                <label>
                  Add note
                  <textarea
                    value={newNote}
                    onChange={(event) => setNewNote(event.target.value)}
                    minLength={3}
                    maxLength={1000}
                    required
                    placeholder="Record investigation or follow-up"
                  />
                </label>
                <small>{newNote.trim().length} / 1000 characters · 3–1000 required</small>
                <button
                  className="button-secondary"
                  type="submit"
                  disabled={busy || newNote.trim().length < 3}
                >
                  {busy ? 'Saving…' : 'Add note'}
                </button>
              </form>
            </>
          ) : (
            <p aria-live="polite">Loading incident details…</p>
          )}
        </AccessibleDialog>
      )}
    </section>
  );
}

function AlertRuleCard({
  rule,
  onSave,
}: {
  rule: AlertRule;
  onSave: (key: string, patch: AlertRulePatch) => Promise<void>;
}) {
  const [enabled, setEnabled] = useState(rule.enabled);
  const [severity, setSeverity] = useState(rule.severity);
  const [forSeconds, setForSeconds] = useState(String(rule.forSeconds));
  const [clearSeconds, setClearSeconds] = useState(String(rule.clearSeconds));
  const [params, setParams] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(rule.params).map(([key, value]) => [key, String(value.value)]),
    ),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setEnabled(rule.enabled);
    setSeverity(rule.severity);
    setForSeconds(String(rule.forSeconds));
    setClearSeconds(String(rule.clearSeconds));
    setParams(
      Object.fromEntries(
        Object.entries(rule.params).map(([key, value]) => [key, String(value.value)]),
      ),
    );
  }, [rule]);
  const submit = async (event: import('react').FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const duration = [Number(forSeconds), Number(clearSeconds)];
    if (duration.some((value) => !Number.isInteger(value) || value < 0 || value > 86_400)) {
      setError('Durations must be whole seconds between 0 and 86400.');
      return;
    }
    const nextParams: Record<string, number> = {};
    for (const [key, definition] of Object.entries(rule.params)) {
      const value = Number(params[key]);
      if (!Number.isFinite(value) || value < definition.min || value > definition.max) {
        setError(
          `${definition.label} must be between ${definition.min} and ${definition.max} ${definition.unit}.`,
        );
        return;
      }
      nextParams[key] = value;
    }
    const patch: AlertRulePatch = {};
    if (enabled !== rule.enabled) patch.enabled = enabled;
    if (severity !== rule.severity) patch.severity = severity;
    if (duration[0] !== rule.forSeconds) patch.forSeconds = duration[0];
    if (duration[1] !== rule.clearSeconds) patch.clearSeconds = duration[1];
    const changedParams = Object.fromEntries(
      Object.entries(nextParams).filter(([key, value]) => value !== rule.params[key]?.value),
    );
    if (Object.keys(changedParams).length) patch.params = changedParams;
    if (!Object.keys(patch).length) {
      setError('No changes to save.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(rule.key, patch);
    } catch (cause) {
      setError(incidentErrorMessage(cause, 'rules'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <article className={`panel alert-rule-card ${rule.enabled ? '' : 'is-disabled'}`}>
      <div className="alert-rule-heading">
        <div>
          <span className="eyebrow">{rule.key}</span>
          <h3>{rule.description}</h3>
        </div>
        <div className="alert-rule-badges">
          <span className={`incident-severity is-${rule.severity}`}>{rule.severity}</span>
          {!rule.enabled && <span className="badge warning">Disabled</span>}
        </div>
      </div>
      <form onSubmit={submit}>
        <div className="alert-rule-fields">
          <label className="rule-enabled">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />{' '}
            Enabled
          </label>
          <FilterPicker
            label="Severity"
            value={severity}
            options={['critical', 'warning', 'info']}
            describe={(value) => value}
            onChange={setSeverity}
          />
          <label>
            Open after (seconds)
            <input
              type="number"
              min={0}
              max={86400}
              step={1}
              value={forSeconds}
              onChange={(event) => setForSeconds(event.target.value)}
            />
          </label>
          <label>
            Clear after (seconds)
            <input
              type="number"
              min={0}
              max={86400}
              step={1}
              value={clearSeconds}
              onChange={(event) => setClearSeconds(event.target.value)}
            />
          </label>
        </div>
        {Object.entries(rule.params).length > 0 && (
          <div className="alert-rule-params">
            <h4>Thresholds</h4>
            {Object.entries(rule.params).map(([key, definition]) => (
              <label key={key}>
                {definition.label}
                <span className="rule-input-with-unit">
                  <input
                    type="number"
                    min={definition.min}
                    max={definition.max}
                    step={definition.unit === 'ratio' ? '0.01' : '1'}
                    value={params[key] ?? ''}
                    onChange={(event) =>
                      setParams((current) => ({ ...current, [key]: event.target.value }))
                    }
                  />
                  <span>{definition.unit}</span>
                </span>
                <small>
                  Range {definition.min}–{definition.max} {definition.unit} · default{' '}
                  {definition.default} {definition.unit}
                </small>
              </label>
            ))}
          </div>
        )}
        <div className="alert-rule-footer">
          <small>
            Updated {rule.updatedAt ? formatDate(rule.updatedAt) : 'Not customized'} · Editing
            requires fleet.operate (SUPER_ADMIN).
          </small>
          <button className="button-secondary" type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save rule'}
          </button>
        </div>
        {error && (
          <p className="permission-panel" role="alert">
            {error}
          </p>
        )}
      </form>
    </article>
  );
}

export function AlertRulesPage({
  baseUrl,
  token,
  authRecovery,
}: {
  baseUrl: string;
  token: string;
  authRecovery: AuthRecovery;
}) {
  const [data, setData] = useState<AlertRules | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await loadAlertRules(baseUrl, token, { recovery: authRecovery }));
      setError(null);
    } catch (cause) {
      setData(null);
      setError(incidentErrorMessage(cause, 'view'));
    } finally {
      setLoading(false);
    }
  }, [baseUrl, token, authRecovery]);
  useEffect(() => {
    void load();
  }, [load]);
  const save = async (key: string, patch: AlertRulePatch) => {
    const next = await patchAlertRule(baseUrl, token, key, patch, { recovery: authRecovery });
    setData((current) =>
      current
        ? { ...current, rules: current.rules.map((rule) => (rule.key === key ? next : rule)) }
        : current,
    );
  };
  return (
    <section className="alert-rules-page">
      <div className="live-intro">
        <span className="eyebrow">EVALUATOR CONFIGURATION</span>
        <h2>Alert rules</h2>
        <p>
          Thresholds used by the fleet incident evaluator. A change is applied by the API and
          audited.
        </p>
      </div>
      <div className="alert-rules-toolbar">
        <span>
          {data
            ? `${data.rules.length} published rules`
            : loading
              ? 'Loading published rules…'
              : 'Rules unavailable'}
        </span>
        <button
          className="link-button"
          type="button"
          onClick={() => void load()}
          disabled={loading}
        >
          Refresh rules
        </button>
      </div>
      {error && (
        <div className="permission-panel" role="alert">
          {error}
        </div>
      )}
      {data && (
        <div className="alert-rule-list">
          {data.rules.map((rule) => (
            <AlertRuleCard key={rule.key} rule={rule} onSave={save} />
          ))}
        </div>
      )}
    </section>
  );
}

function FixtureIncidentList({ data }: { data: ReturnType<typeof parseIncidentList> }) {
  return data.items.length ? (
    <div className="table-wrap">
      <table className="incident-table">
        <thead>
          <tr>
            <th>State</th>
            <th>Severity</th>
            <th>Worker</th>
            <th>Rule</th>
            <th>Summary</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((incident) => (
            <tr key={incident.id}>
              <td>{incident.state}</td>
              <td>{incident.severity}</td>
              <td>{incident.workerId}</td>
              <td>{incident.ruleKey}</td>
              <td>{incident.summary}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <div className="incident-empty">
      <h3>No incidents recorded</h3>
      <p>The evaluator and GPU box agents are not live yet.</p>
    </div>
  );
}
function FixtureIncidentDetail({ data }: { data: IncidentDetail }) {
  return (
    <div className="detail-grid">
      <section>
        <h4>{data.incident.summary}</h4>
        <EvidenceRows evidence={data.incident.evidence} />
      </section>
      <section>
        <Timeline detail={data} />
      </section>
    </div>
  );
}
function FixtureRuleList({ data }: { data: AlertRules }) {
  return (
    <div className="gallery-rule-grid">
      {data.rules.map((rule) => (
        <article
          className={`panel alert-rule-card ${rule.enabled ? '' : 'is-disabled'}`}
          key={rule.key}
        >
          <div className="panel-heading">
            <strong>{rule.key}</strong>
            {!rule.enabled && <span className="badge warning">Disabled</span>}
          </div>
          <p>{rule.description}</p>
          <span>
            {rule.severity} · opens after {rule.forSeconds}s · clears after {rule.clearSeconds}s
          </span>
          {Object.entries(rule.params).map(([key, param]) => (
            <p key={key}>
              {param.label}: {param.value} {param.unit} (range {param.min}–{param.max})
            </p>
          ))}
        </article>
      ))}
    </div>
  );
}

export function IncidentFixtureGallery() {
  if (!import.meta.env.DEV) return null;
  const fixtures = import.meta.glob('../../../docs/fleet-contracts/*.json', {
    eager: true,
    import: 'default',
  }) as Record<string, unknown>;
  const get = (name: string) =>
    Object.entries(fixtures).find(([path]) => path.endsWith(`/${name}`))?.[1];
  const list = get('incidents.list.json');
  const empty = get('incidents.empty.json');
  const summary = get('incidents.summary.json');
  const open = get('incident.detail.open.json');
  const acked = get('incident.detail.acked.json');
  const recovered = get('incident.detail.recovered.json');
  const rules = get('alert-rules.json');
  const detailFixtures: [string, unknown][] = [
    ['Open', open],
    ['Acknowledged', acked],
    ['Recovered / escalated', recovered],
  ];
  return (
    <section className="panel incident-fixture-gallery">
      <h2>Incidents & alert rules · 7 contract fixtures</h2>
      <article className="panel">
        <h3>Incidents list</h3>
        {list ? <FixtureIncidentList data={parseIncidentList(list)} /> : <p>Fixture missing.</p>}
      </article>
      <article className="panel">
        <h3>Empty list</h3>
        {empty ? <FixtureIncidentList data={parseIncidentList(empty)} /> : <p>Fixture missing.</p>}
      </article>
      <article className="panel">
        <h3>Summary counts</h3>
        {summary ? (
          <div className="incident-summary-fixture">
            {Object.entries(parseIncidentSummary(summary).bySeverity).map(([key, value]) => (
              <div key={key}>
                <span>{key}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
        ) : (
          <p>Fixture missing.</p>
        )}
      </article>
      <div className="gallery-incident-details">
        {detailFixtures.map(([label, fixture]) => (
          <article className="panel" key={label}>
            <h3>{label}</h3>
            {fixture ? (
              <FixtureIncidentDetail data={parseIncidentDetail(fixture)} />
            ) : (
              <p>Fixture missing.</p>
            )}
          </article>
        ))}
      </div>
      <article className="panel">
        <h3>All alert rules</h3>
        {rules ? <FixtureRuleList data={parseAlertRules(rules)} /> : <p>Fixture missing.</p>}
      </article>
    </section>
  );
}
