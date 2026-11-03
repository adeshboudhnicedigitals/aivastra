import { useState } from 'react';
import type { FleetSnapshot } from './contracts';
import type { OperationsManager } from './OperationsControls';
import type { WorkspaceManager } from './Workspace';
import type { QueueJob } from './workspace-demo';
import { canCancel, canRetry } from './workspace-demo';
import { Actions, AuditFields, Choices, DemoModal, demoEntry, fullTime } from './workspace-ui';

export function QueuePage({
  manager,
  data,
  operations,
  openWorker,
}: {
  manager: WorkspaceManager;
  data: FleetSnapshot;
  operations: OperationsManager;
  openWorker: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('ALL');
  const [owner, setOwner] = useState('ALL');
  const [selected, setSelected] = useState<string | null>(null);
  const [request, setRequest] = useState<{ job: QueueJob; action: 'CANCEL' | 'RETRY' } | null>(
    null,
  );
  const [reset, setReset] = useState(false);
  const [actor, setActor] = useState('Demo operator');
  const [note, setNote] = useState('');
  const [worker, setWorker] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const { state, dispatch } = manager;
  const jobs = state.jobs.filter(
    (job) =>
      `${job.id} ${job.workerId} ${job.promptId ?? ''}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (status === 'ALL' || job.status === status) &&
      (owner === 'ALL' || job.ownership === owner),
  );
  const detail = state.jobs.find((job) => job.id === selected);
  const eligible = data.workers.filter(
    (item) =>
      item.active &&
      item.inRegistry &&
      item.health === 'HEALTHY' &&
      ['IDLE', 'BUSY'].includes(item.dispatcherState) &&
      operations.state.routing[item.workerId] !== 'DRAINING' &&
      !operations.state.reservations[item.workerId] &&
      item.jobTypes.includes(request?.job.type ?? 'TRY_ON'),
  );
  const close = () => {
    setRequest(null);
    setReset(false);
    setNote('');
    setError('');
  };
  return (
    <>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Job queue preview</h2>
            <p className="muted">
              Cancel and retry owned work without touching real queues, prompts or credits.
            </p>
          </div>
          <button type="button" className="action-secondary" onClick={() => setReset(true)}>
            Reset queue preview
          </button>
        </div>
        <p className="notice">
          Synthetic job attempts. Foreign or unknown-owned work is inspectable, but cannot be
          cancelled or retried here. Retrying creates a new queued attempt; original outcomes remain
          visible.
        </p>
        <label className="search">
          <input
            aria-label="Search queue"
            placeholder="Job, worker or prompt…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="filter-row workspace-filters">
          {['ALL', 'QUEUED', 'RUNNING', 'FAILED', 'CANCELLED', 'SUCCEEDED'].map((value) => (
            <button
              type="button"
              key={value}
              className={status === value ? 'filter selected' : 'filter'}
              aria-pressed={status === value}
              onClick={() => setStatus(value)}
            >
              {value === 'ALL' ? 'All statuses' : value}
            </button>
          ))}
        </div>
        <div className="filter-row">
          {['ALL', 'PRODUCTION', 'DEVELOPER', 'FOREIGN'].map((value) => (
            <button
              type="button"
              key={value}
              className={owner === value ? 'filter selected' : 'filter'}
              aria-pressed={owner === value}
              onClick={() => setOwner(value)}
            >
              {value === 'ALL' ? 'All ownership' : value}
            </button>
          ))}
        </div>
        <div role="status" className="process-feedback">
          {notice}
        </div>
        {jobs.map((job) => (
          <article className="queue-row instance-row" key={job.id}>
            <div>
              <button type="button" className="worker-link" onClick={() => setSelected(job.id)}>
                {job.id}
              </button>
              <small>
                {job.type} · Attempt {job.attempt} · {job.ownership}
              </small>
              <button type="button" className="text-link" onClick={() => openWorker(job.workerId)}>
                {job.workerId} ↗
              </button>
              <small>{job.retryOf ? `Retry of ${job.retryOf}` : 'Original attempt'}</small>
            </div>
            <span
              className={`badge ${job.status === 'FAILED' ? 'danger' : job.status === 'RUNNING' ? 'blue' : 'neutral'}`}
            >
              {job.status} · DEMO
            </span>
            <div className="process-actions">
              <button
                type="button"
                className="action-secondary"
                disabled={!canCancel(job)}
                onClick={() => {
                  setRequest({ job, action: 'CANCEL' });
                  setNote('');
                }}
              >
                Cancel job
              </button>
              <button
                type="button"
                className="action-secondary"
                disabled={!canRetry(job, state.jobs)}
                onClick={() => {
                  setWorker('');
                  setRequest({ job, action: 'RETRY' });
                  setNote('');
                }}
              >
                Retry job
              </button>
            </div>
          </article>
        ))}
        {jobs.length === 0 && (
          <div className="empty">
            No jobs match these filters.
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setOwner('ALL');
                setStatus('ALL');
              }}
            >
              Clear queue filters
            </button>
          </div>
        )}
      </section>
      {detail && (
        <DemoModal title={`Job details · ${detail.id}`} close={() => setSelected(null)}>
          <dl>
            <dt>Status / ownership</dt>
            <dd>
              {detail.status} / {detail.ownership}
            </dd>
            <dt>Worker</dt>
            <dd>{detail.workerId}</dd>
            <dt>Prompt reference</dt>
            <dd>{detail.promptId ?? 'Not submitted / not recorded'}</dd>
            <dt>Attempt</dt>
            <dd>{detail.attempt}</dd>
            <dt>Recorded at</dt>
            <dd>{fullTime(detail.at)}</dd>
            <dt>Execution duration</dt>
            <dd>{detail.executionMs === null ? 'Unavailable' : `${detail.executionMs / 1000}s`}</dd>
          </dl>
          <p className="notice">
            Dispatcher attempt status and final job outcome are distinct. This synthetic preview
            does not establish billing, refunds or successful execution.
          </p>
          <div className="dialog-actions">
            <button type="button" className="action-secondary" onClick={() => setSelected(null)}>
              Close details
            </button>
          </div>
        </DemoModal>
      )}
      {(request || reset) && (
        <DemoModal
          title={
            reset
              ? 'Reset queue preview?'
              : `${request?.action === 'CANCEL' ? 'Cancel job' : 'Retry job'} · ${request?.job.id}`
          }
          close={close}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!actor.trim() || !note.trim()) return;
              if (reset) {
                dispatch({
                  type: 'RESET_QUEUE',
                  data,
                  entry: demoEntry('queue', 'RESET_QUEUE', actor, note),
                });
                setNotice('Queue restored. Other previews are unchanged.');
              } else if (request?.action === 'CANCEL') {
                dispatch({
                  type: 'CANCEL',
                  id: request.job.id,
                  entry: demoEntry(request.job.id, 'CANCEL_JOB', actor, note, request.job.workerId),
                });
                setNotice('Cancellation simulated. No live prompt or credits changed.');
              } else if (request) {
                if (!eligible.some((item) => item.workerId === worker)) {
                  setError('Choose an eligible destination worker.');
                  return;
                }
                dispatch({
                  type: 'RETRY',
                  data,
                  id: request.job.id,
                  newId: `demo-retry-${crypto.randomUUID().slice(0, 8)}`,
                  workerId: worker,
                  entry: demoEntry(request.job.id, 'RETRY_JOB', actor, note, worker),
                });
                setNotice(
                  'New queued attempt created in the preview. No work submitted or charge made.',
                );
              }
              close();
            }}
          >
            <p>
              {reset
                ? 'Restore initial synthetic job attempts. Record why you are clearing the queue preview.'
                : request?.action === 'CANCEL'
                  ? 'The selected preview attempt becomes CANCELLED. A live cancellation could interrupt work; this simulation has no live effect.'
                  : 'Choose a healthy, registered, active worker supporting this job type. Preview drains and reservations are respected. Nothing executes automatically.'}
            </p>
            {request?.action === 'RETRY' && (
              <>
                <Choices
                  label="Destination worker"
                  value={worker}
                  change={setWorker}
                  options={eligible.map((item) => ({
                    value: item.workerId,
                    label: `${item.workerId} · ${item.hostId}`,
                  }))}
                />
                {eligible.length === 0 && (
                  <p className="form-error">
                    No eligible workers. Review reservations and routing preview.
                  </p>
                )}
              </>
            )}
            <AuditFields actor={actor} note={note} setActor={setActor} setNote={setNote} />
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            <Actions
              close={close}
              label={
                reset
                  ? 'Reset demo queue'
                  : request?.action === 'CANCEL'
                    ? 'Simulate cancel job'
                    : 'Create demo retry'
              }
              disabled={!actor.trim() || !note.trim()}
            />
          </form>
        </DemoModal>
      )}
    </>
  );
}
