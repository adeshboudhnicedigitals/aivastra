import { useState } from 'react';
import type { FleetSnapshot } from './contracts';
import type { WorkspaceManager } from './Workspace';
import { captureComplete, captureFixtures } from './workspace-demo';
import { Actions, AuditFields, DemoModal, demoEntry, fullTime } from './workspace-ui';

export function EvidencePage({
  manager,
  data,
  openIncident,
}: {
  manager: WorkspaceManager;
  data: FleetSnapshot;
  openIncident: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('ALL');
  const [selected, setSelected] = useState(captureFixtures[0].id);
  const [reviewing, setReviewing] = useState(false);
  const [reset, setReset] = useState(false);
  const [actor, setActor] = useState('Demo operator');
  const [note, setNote] = useState('');
  const [notice, setNotice] = useState('');
  const capture = captureFixtures.find((item) => item.id === selected);
  const matches = captureFixtures.filter(
    (item) =>
      `${item.workerId} ${item.id} ${item.incidentId}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (filter === 'ALL' || filter === item.pass || (filter === 'GAPS' && !captureComplete(item))),
  );
  const close = () => {
    setReviewing(false);
    setReset(false);
    setNote('');
  };
  return (
    <>
      <section className="panel">
        <div className="panel-heading">
          <h2>Evidence workspace</h2>
          <button type="button" className="action-secondary" onClick={() => setReset(true)}>
            Reset evidence reviews
          </button>
        </div>
        <p className="notice">
          Synthetic manifests and sanitized findings only. No live capture files are loaded. Guest
          observations are untrusted; COMPLETE means transport completeness, not a clean host.
          Non-OK coverage requires explanation, not automatic compromise classification.
        </p>
        <label className="search">
          <input
            aria-label="Search evidence"
            placeholder="Capture, incident or worker…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="filter-row workspace-filters">
          {['ALL', 'A', 'B', 'GAPS'].map((value) => (
            <button
              type="button"
              key={value}
              className={filter === value ? 'filter selected' : 'filter'}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {value === 'ALL'
                ? 'All captures'
                : value === 'GAPS'
                  ? 'Coverage gaps'
                  : `Pass ${value}`}
            </button>
          ))}
        </div>
        <div role="status" className="process-feedback">
          {notice}
        </div>
      </section>
      <div className="incident-layout">
        <div className="incident-list">
          {matches.map((item) => (
            <button
              type="button"
              key={item.id}
              className={`incident-card ${selected === item.id ? 'chosen' : ''}`}
              onClick={() => setSelected(item.id)}
            >
              <span className="mono">{item.id}</span>
              <h3>
                {item.workerId} · Pass {item.pass}
              </h3>
              <div>
                <span>{item.transport}</span>
                <span>{captureComplete(item) ? 'All sources OK' : 'Coverage needs review'}</span>
              </div>
              <small>
                {manager.state.reviews[item.id] ? 'Review recorded · DEMO' : 'Not reviewed'}
              </small>
            </button>
          ))}
          {matches.length === 0 && (
            <div className="empty">
              No matching captures.
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setFilter('ALL');
                }}
              >
                Clear evidence filters
              </button>
            </div>
          )}
        </div>
        {capture && matches.some((item) => item.id === capture.id) ? (
          <section className="panel evidence-detail">
            <span className="eyebrow">SYNTHETIC GUEST-SOURCED RECORD</span>
            <h2>{capture.id}</h2>
            <dl>
              <dt>Worker / mode</dt>
              <dd>
                {capture.workerId} / Pass {capture.pass}
              </dd>
              <dt>Captured at</dt>
              <dd>{fullTime(capture.capturedAt)}</dd>
              <dt>Transport</dt>
              <dd>{capture.transport}</dd>
              <dt>coverageAllOk</dt>
              <dd>{captureComplete(capture) ? 'yes' : 'no'}</dd>
              <dt>Baseline revision</dt>
              <dd>1.4.2 · sample only</dd>
              <dt>Artifact hashes</dt>
              <dd>Not available in synthetic preview</dd>
            </dl>
            <button
              type="button"
              className="text-link"
              onClick={() => openIncident(capture.incidentId)}
            >
              Open {capture.incidentId} ↗
            </button>
            <h3>Source coverage</h3>
            <div className="coverage-list">
              {Object.entries(capture.coverage).map(([source, status]) => (
                <div key={source}>
                  <span>{source}</span>
                  <span
                    className={`badge ${status === 'OK' ? 'good' : status === 'TRUNCATED' ? 'warning' : 'danger'}`}
                  >
                    {status}
                  </span>
                </div>
              ))}
            </div>
            <h3>Sanitized stderr examples</h3>
            {capture.stderr.length ? (
              capture.stderr.map((line) => (
                <p className="diagnostic" key={line}>
                  {line}
                </p>
              ))
            ) : (
              <p className="muted">No sample stderr diagnostics.</p>
            )}
            <h3>Findings / limits</h3>
            {capture.findings.map((finding) => (
              <p className="note" key={finding}>
                {finding}
              </p>
            ))}
            {manager.state.reviews[capture.id] && (
              <div className="notice">
                Review by {manager.state.reviews[capture.id].owner} ·{' '}
                {fullTime(manager.state.reviews[capture.id].at)}
                <p>{manager.state.reviews[capture.id].note}</p>
              </div>
            )}
            <button type="button" className="action-primary" onClick={() => setReviewing(true)}>
              Record evidence review
            </button>
            <p className="footnote">
              A review never changes original coverage, transport status or incident classification.
            </p>
          </section>
        ) : (
          <section className="panel empty">Select a matching capture to inspect.</section>
        )}
      </div>
      {(reviewing || reset) && (
        <DemoModal
          title={reset ? 'Reset evidence reviews?' : `Review ${capture?.id}`}
          close={close}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!actor.trim() || !note.trim()) return;
              if (reset) {
                manager.dispatch({
                  type: 'RESET_EVIDENCE',
                  data,
                  entry: demoEntry('evidence', 'RESET_EVIDENCE', actor, note),
                });
                setNotice('Local evidence reviews cleared. Capture fixtures unchanged.');
              } else if (capture) {
                manager.dispatch({
                  type: 'REVIEW',
                  id: capture.id,
                  entry: demoEntry(capture.id, 'EVIDENCE_REVIEW', actor, note),
                });
                setNotice('Evidence review recorded in this session only.');
              }
              close();
            }}
          >
            <p>
              Record review context and known gaps. This is not an integrity verification or
              incident conclusion.
            </p>
            <AuditFields actor={actor} note={note} setActor={setActor} setNote={setNote} />
            <Actions
              close={close}
              label={reset ? 'Reset demo reviews' : 'Save demo review'}
              disabled={!actor.trim() || !note.trim()}
            />
          </form>
        </DemoModal>
      )}
    </>
  );
}
