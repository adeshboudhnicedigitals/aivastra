import { useEffect, useReducer, useRef, useState } from 'react';
import type { FleetSnapshot, IncidentView } from './contracts';
import { fixtureSnapshot } from './fixtures';
import type { Maintenance, OperationEntry } from './operations-demo';
import {
  operationsReducer,
  reservationError,
  seedOperations,
  windowError,
} from './operations-demo';

export function useOperationsDemo() {
  const [state, dispatch] = useReducer(operationsReducer, fixtureSnapshot, seedOperations);
  return { state, dispatch };
}
export type OperationsManager = ReturnType<typeof useOperationsDemo>;
type Action =
  | 'RESERVE'
  | 'RELEASE'
  | 'DRAIN'
  | 'RESUME'
  | 'SCHEDULE'
  | 'CANCEL_MAINTENANCE'
  | 'RESET';
const labels: Record<Action, string> = {
  RESERVE: 'Reserve worker',
  RELEASE: 'Release reservation',
  DRAIN: 'Drain routing',
  RESUME: 'Resume routing',
  SCHEDULE: 'Schedule maintenance',
  CANCEL_MAINTENANCE: 'Cancel maintenance',
  RESET: 'Reset operations preview',
};
function timestamp(value: string | null) {
  return value
    ? new Date(value).toISOString().replace('T', ' ').replace('.000Z', ' UTC')
    : 'Not specified';
}
function toIso(value: string) {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : '';
}
export function OperationsControls({
  manager,
  data,
  workerId,
}: {
  manager: OperationsManager;
  data: FleetSnapshot;
  workerId?: string;
}) {
  const { state, dispatch } = manager;
  const [request, setRequest] = useState<{
    action: Action;
    workerId: string;
    maintenanceId?: string;
  } | null>(null);
  const [actor, setActor] = useState('Demo operator');
  const [reason, setReason] = useState('');
  const [from, setFrom] = useState('');
  const [until, setUntil] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (request) dialog.current?.showModal();
    else dialog.current?.close();
  }, [request]);
  const close = () => {
    setRequest(null);
    setReason('');
    setFrom('');
    setUntil('');
    setError('');
  };
  const open = (action: Action, id: string, maintenanceId?: string) => {
    setRequest({ action, workerId: id, maintenanceId });
    setError('');
  };
  const workers = data.workers.filter((worker) => !workerId || worker.workerId === workerId);
  const maintenance = state.maintenance.filter((item) => !workerId || item.workerId === workerId);
  const submit = () => {
    if (!request) return;
    if (request.action === 'RESET') {
      dispatch({ type: 'RESET', data });
      setNotice('Operations preview restored. Process preview is unchanged.');
      close();
      return;
    }
    const now = new Date().toISOString();
    if (!actor.trim() || !reason.trim()) {
      setError('Record an operator and reason for the simulation.');
      return;
    }
    const entry: OperationEntry = {
      id: crypto.randomUUID(),
      at: now,
      target: request.workerId,
      actor: actor.trim(),
      action: request.action,
      note: reason.trim(),
    };
    if (request.action === 'RESERVE') {
      const invalid = reservationError(toIso(until), now);
      if (invalid) {
        setError(invalid);
        return;
      }
      dispatch({
        type: 'RESERVE',
        entry,
        reservation: { owner: actor.trim(), reason: reason.trim(), until: toIso(until) },
      });
    } else if (request.action === 'SCHEDULE') {
      const invalid = windowError(toIso(from), toIso(until), now);
      if (invalid) {
        setError(invalid);
        return;
      }
      const item: Maintenance = {
        id: crypto.randomUUID(),
        workerId: request.workerId,
        owner: actor.trim(),
        reason: reason.trim(),
        from: toIso(from),
        until: toIso(until),
        state: 'SCHEDULED',
      };
      if (
        state.maintenance.some(
          (existing) =>
            existing.workerId === item.workerId &&
            existing.state === 'SCHEDULED' &&
            Date.parse(existing.from) < Date.parse(item.until) &&
            Date.parse(item.from) < Date.parse(existing.until),
        )
      ) {
        setError('This worker already has overlapping scheduled maintenance.');
        return;
      }
      dispatch({ type: 'SCHEDULE', entry, maintenance: item });
    } else if (request.action === 'CANCEL_MAINTENANCE') {
      if (!request.maintenanceId) return;
      dispatch({ type: 'CANCEL_MAINTENANCE', entry, id: request.maintenanceId });
    } else dispatch({ type: request.action, entry });
    setNotice(`${labels[request.action]} simulated for ${request.workerId}. No command executed.`);
    close();
  };
  const selected = data.workers.find((worker) => worker.workerId === request?.workerId);
  return (
    <section className="panel operations-controls">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">BROWSER-ONLY SIMULATION</span>
          <h2>Reservations, routing & maintenance</h2>
        </div>
        <button type="button" className="action-secondary" onClick={() => open('RESET', '')}>
          Reset operations preview
        </button>
      </div>
      <p className="notice">
        Demo only—no command executed. Routing intent is shown separately from dispatcher
        observations. Scheduled maintenance records do not run commands or auto-drain workers.
      </p>
      <div role="status" className="process-feedback">
        {notice}
      </div>
      {workers.map((worker) => {
        const reservation = state.reservations[worker.workerId];
        const routing = state.routing[worker.workerId];
        const draining = routing ? routing === 'DRAINING' : worker.dispatcherState === 'DRAINING';
        return (
          <article className="instance-row operation-worker" key={worker.workerId}>
            <div>
              <h3>{worker.workerId}</h3>
              <small>
                {worker.hostId} → {worker.gpuId}
              </small>
              <small>Observed dispatcher: {worker.dispatcherState}</small>
              <small className={routing ? 'text-warning' : 'muted'}>
                Routing preview: {routing ?? 'No override'}
              </small>
              {reservation ? (
                <>
                  <small>
                    Reserved by {reservation.owner}: {reservation.reason}
                  </small>
                  <small>Until {timestamp(reservation.until)}</small>
                </>
              ) : (
                <small>Reservation preview: available</small>
              )}
            </div>
            <div className="process-actions">
              <button
                type="button"
                className="action-secondary"
                onClick={() => open(reservation ? 'RELEASE' : 'RESERVE', worker.workerId)}
              >
                {reservation ? 'Release reservation' : 'Reserve worker'}
              </button>
              <button
                type="button"
                className="action-secondary"
                disabled={
                  worker.dispatcherState === 'UNKNOWN' || !worker.active || !worker.inRegistry
                }
                onClick={() => open(draining ? 'RESUME' : 'DRAIN', worker.workerId)}
              >
                {draining ? 'Resume routing' : 'Drain routing'}
              </button>
              <button
                type="button"
                className="action-secondary"
                onClick={() => open('SCHEDULE', worker.workerId)}
              >
                Schedule maintenance
              </button>
            </div>
          </article>
        );
      })}
      <h3>Maintenance schedule</h3>
      {maintenance.length ? (
        maintenance.map((item) => (
          <article className="maintenance-row" key={item.id}>
            <div>
              <strong>
                {item.workerId} · {item.state}
              </strong>
              <small>
                {timestamp(item.from)} → {timestamp(item.until)}
              </small>
              <small>
                {item.owner} · {item.reason}
              </small>
            </div>
            {item.state === 'SCHEDULED' && (
              <button
                type="button"
                className="action-secondary"
                onClick={() => open('CANCEL_MAINTENANCE', item.workerId, item.id)}
              >
                Cancel maintenance
              </button>
            )}
          </article>
        ))
      ) : (
        <p className="muted">No maintenance scheduled in this preview.</p>
      )}
      <details className="simulation-history">
        <summary>
          Operations history (
          {state.history.filter((entry) => !workerId || entry.target === workerId).length})
        </summary>
        <ol className="audit">
          {state.history
            .filter((entry) => !workerId || entry.target === workerId)
            .map((entry) => (
              <li key={entry.id}>
                <small>
                  {timestamp(entry.at)} · {entry.actor} · DEMO
                </small>
                <p>
                  {entry.target} · {entry.action} · {entry.note}
                </p>
              </li>
            ))}
        </ol>
      </details>
      <dialog
        ref={dialog}
        className="process-dialog"
        onCancel={close}
        onClose={close}
        aria-labelledby="operations-dialog-title"
      >
        {request && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <span className="eyebrow">DEMO ONLY · NO COMMAND EXECUTED</span>
            <h2 id="operations-dialog-title">
              {labels[request.action]}
              {selected ? ` · ${selected.workerId}` : ''}
            </h2>
            {request.action === 'RESET' ? (
              <p>
                Clear simulated reservations, routing intent, maintenance, incident acknowledgments
                and notes, and restore the fixture reservations. Process preview and original
                observations are unchanged.
              </p>
            ) : (
              <>
                <p>
                  {request.action === 'DRAIN'
                    ? 'Preview removing this worker from routing after its owned work finishes. This does not stop a ComfyUI instance or change fixture jobs.'
                    : request.action === 'RESUME'
                      ? 'Preview returning this worker to routing. Readiness is unverified; this is not a health check.'
                      : request.action === 'SCHEDULE'
                        ? 'Record a future maintenance window. It will not trigger actions automatically.'
                        : 'Update only this session’s reservation or maintenance preview.'}
                </p>
                {selected && (
                  <p className="notice">
                    Observed state: {selected.dispatcherState}. Fixture queue:{' '}
                    {selected.comfy.running ?? 'Unknown'} running /{' '}
                    {selected.comfy.pending ?? 'Unknown'} pending.
                    {selected.activeIncident
                      ? ` Active incident: ${selected.activeIncident.id}.`
                      : ''}{' '}
                    {data.workers.filter((worker) => worker.gpuId === selected.gpuId).length > 1
                      ? 'Shared GPU: this preview targets one logical worker.'
                      : ''}
                  </p>
                )}
                <label className="form-field">
                  Operator
                  <input
                    required
                    maxLength={80}
                    value={actor}
                    onChange={(event) => setActor(event.target.value)}
                  />
                </label>
                <label className="form-field">
                  Reason
                  <textarea
                    required
                    maxLength={1000}
                    rows={3}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </label>
                {request.action === 'SCHEDULE' && (
                  <label className="form-field">
                    Start time (your local timezone)
                    <input
                      required
                      type="datetime-local"
                      value={from}
                      onChange={(event) => setFrom(event.target.value)}
                    />
                  </label>
                )}
                {['SCHEDULE', 'RESERVE'].includes(request.action) && (
                  <label className="form-field">
                    End time (your local timezone)
                    <input
                      required
                      type="datetime-local"
                      value={until}
                      onChange={(event) => setUntil(event.target.value)}
                    />
                  </label>
                )}
              </>
            )}
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            <div className="dialog-actions">
              <button type="button" className="action-secondary" onClick={close}>
                Cancel
              </button>
              <button type="submit" className="action-primary">
                {request.action === 'RESET'
                  ? 'Reset operations simulation'
                  : `Simulate ${labels[request.action].toLowerCase()}`}
              </button>
            </div>
          </form>
        )}
      </dialog>
    </section>
  );
}
export function IncidentActions({
  incident,
  manager,
}: {
  incident: IncidentView;
  manager: OperationsManager;
}) {
  const [action, setAction] = useState<'ACK' | 'NOTE' | null>(null);
  const [actor, setActor] = useState('Demo operator');
  const [note, setNote] = useState('');
  const [notice, setNotice] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (action) dialog.current?.showModal();
    else dialog.current?.close();
  }, [action]);
  const close = () => {
    setAction(null);
    setNote('');
  };
  return (
    <div className="incident-actions">
      <div className="process-actions">
        <button
          type="button"
          className="action-primary"
          disabled={incident.state !== 'OPEN'}
          onClick={() => setAction('ACK')}
        >
          Acknowledge incident
        </button>
        <button type="button" className="action-secondary" onClick={() => setAction('NOTE')}>
          Add note
        </button>
      </div>
      <p className="footnote">
        Demo only. Notes and acknowledgment stay in this browser session. Evidence availability and
        classification are unchanged.
      </p>
      <div role="status" className="process-feedback">
        {notice}
      </div>
      <dialog
        ref={dialog}
        className="process-dialog"
        onCancel={close}
        onClose={close}
        aria-labelledby="incident-action-title"
      >
        {action && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!actor.trim() || !note.trim() || (action === 'ACK' && incident.state !== 'OPEN'))
                return;
              manager.dispatch({
                type: action,
                entry: {
                  id: crypto.randomUUID(),
                  at: new Date().toISOString(),
                  actor: actor.trim(),
                  target: incident.id,
                  action,
                  note: note.trim(),
                },
              });
              setNotice(
                `${action === 'ACK' ? 'Acknowledgment' : 'Note'} simulated. No command executed.`,
              );
              close();
            }}
          >
            <span className="eyebrow">BROWSER-ONLY SIMULATION</span>
            <h2 id="incident-action-title">
              {action === 'ACK' ? 'Acknowledge incident' : 'Add incident note'} · {incident.id}
            </h2>
            <p>
              {action === 'ACK'
                ? 'Preview OPEN → ACK. This does not change classification, close the incident or authorize containment.'
                : 'Add a local operator note to the simulated record and audit trail.'}
            </p>
            <label className="form-field">
              Operator
              <input
                required
                maxLength={80}
                value={actor}
                onChange={(event) => setActor(event.target.value)}
              />
            </label>
            <label className="form-field">
              {action === 'ACK' ? 'Acknowledgment note' : 'Note'}
              <textarea
                required
                maxLength={2000}
                rows={4}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </label>
            <div className="dialog-actions">
              <button type="button" className="action-secondary" onClick={close}>
                Cancel
              </button>
              <button
                type="submit"
                className="action-primary"
                disabled={!actor.trim() || !note.trim()}
              >
                {action === 'ACK' ? 'Simulate acknowledge' : 'Save demo note'}
              </button>
            </div>
          </form>
        )}
      </dialog>
    </div>
  );
}
