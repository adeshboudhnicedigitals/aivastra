import { useState } from 'react';
import type { OperationsManager } from './OperationsControls';
import type { ProcessManager } from './ProcessControls';
import type { WorkspaceManager } from './Workspace';
import { captureFixtures } from './workspace-demo';
import { fullTime } from './workspace-ui';

export function ActivityPage({
  operations,
  processes,
  workspace,
}: {
  operations: OperationsManager;
  processes: ProcessManager;
  workspace: WorkspaceManager;
}) {
  const [query, setQuery] = useState('');
  const [actor, setActor] = useState('');
  const [group, setGroup] = useState('ALL');
  const [action, setAction] = useState('ALL');
  const [from, setFrom] = useState('');
  const [until, setUntil] = useState('');
  const entries = [
    ...processes.state.history.map((entry) => ({
      ...entry,
      key: `process-${entry.id}`,
      target: entry.instance,
      workerId:
        entry.workerId ??
        processes.state.instances.find((instance) => instance.name === entry.instance)?.workerId ??
        '',
      actor: entry.actor ?? 'Browser demo',
      note: entry.detail,
      group: 'PROCESS',
    })),
    ...operations.state.history.map((entry) => ({
      ...entry,
      workerId: entry.target.startsWith('worker-') ? entry.target : '',
      key: `operations-${entry.id}`,
      group: 'OPERATIONS',
    })),
    ...workspace.state.history.map((entry) => ({
      ...entry,
      workerId:
        entry.workerId ??
        workspace.state.jobs.find((job) => job.id === entry.target)?.workerId ??
        captureFixtures.find((capture) => capture.id === entry.target)?.workerId ??
        '',
      key: `workspace-${entry.id}`,
      group:
        entry.action.includes('JOB') || entry.action === 'RESET_QUEUE'
          ? 'QUEUE'
          : entry.action.includes('EVIDENCE')
            ? 'EVIDENCE'
            : 'INVENTORY',
    })),
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const invalid = Boolean(from && until && Date.parse(from) > Date.parse(until));
  const filtered = entries.filter(
    (entry) =>
      !invalid &&
      `${entry.target} ${entry.workerId} ${entry.note}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      entry.actor.toLowerCase().includes(actor.toLowerCase()) &&
      (group === 'ALL' || entry.group === group) &&
      (action === 'ALL' || entry.action === action) &&
      (!from || Date.parse(entry.at) >= Date.parse(from)) &&
      (!until || Date.parse(entry.at) <= Date.parse(until)),
  );
  const clear = () => {
    setQuery('');
    setActor('');
    setGroup('ALL');
    setAction('ALL');
    setFrom('');
    setUntil('');
  };
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>
          Activity log <span className="muted">({filtered.length})</span>
        </h2>
        <button type="button" className="action-secondary" onClick={clear}>
          Clear activity filters
        </button>
      </div>
      <p className="notice">
        Combined browser-session simulations only. This is not a durable production audit log.
        Reloading clears it; resetting a preview may clear that area’s history. Original fixture
        incident audit records remain on the incident page.
      </p>
      <div className="activity-fields">
        <label className="form-field">
          Target / worker / text
          <input value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <label className="form-field">
          Operator filter
          <input value={actor} onChange={(event) => setActor(event.target.value)} />
        </label>
        <label className="form-field">
          From (local time)
          <input
            type="datetime-local"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </label>
        <label className="form-field">
          Until (local time)
          <input
            type="datetime-local"
            value={until}
            onChange={(event) => setUntil(event.target.value)}
          />
        </label>
      </div>
      <div className="filter-row">
        {['ALL', 'PROCESS', 'OPERATIONS', 'QUEUE', 'EVIDENCE', 'INVENTORY'].map((value) => (
          <button
            type="button"
            key={value}
            className={group === value ? 'filter selected' : 'filter'}
            aria-pressed={group === value}
            onClick={() => {
              setGroup(value);
              setAction('ALL');
            }}
          >
            {value === 'ALL' ? 'All areas' : value}
          </button>
        ))}
      </div>
      <div className="filter-row">
        {[
          'ALL',
          ...new Set(
            entries
              .filter((entry) => group === 'ALL' || entry.group === group)
              .map((entry) => entry.action),
          ),
        ].map((value) => (
          <button
            type="button"
            key={value}
            className={action === value ? 'filter selected' : 'filter'}
            aria-pressed={action === value}
            onClick={() => setAction(value)}
          >
            {value === 'ALL' ? 'All action types' : value.replaceAll('_', ' ')}
          </button>
        ))}
      </div>
      {invalid && (
        <p role="alert" className="form-error">
          From time must not be later than Until time.
        </p>
      )}
      <ol className="activity-list">
        {filtered.map((entry) => (
          <li key={entry.key}>
            <span className="badge neutral">{entry.group} · DEMO</span>
            <h3>
              {entry.target} · {entry.action}
              {entry.workerId ? ` · ${entry.workerId}` : ''}
            </h3>
            <small>
              {fullTime(entry.at)} · {entry.actor}
            </small>
            <p>{entry.note}</p>
          </li>
        ))}
      </ol>
      {filtered.length === 0 && (
        <div className="empty">
          No activity matches. Try a simulated action or clear the filters.
        </div>
      )}
    </section>
  );
}
