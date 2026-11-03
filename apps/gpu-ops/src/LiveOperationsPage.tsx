import { type FormEvent, useRef, useState } from 'react';
import { AccessibleDialog } from './AccessibleDialog';
import type { AuthRecovery } from './auth';
import {
  cancelMaintenance,
  loadOperations,
  type MaintenanceWindow,
  type Operations,
  operationsErrorMessage,
  releaseReservation,
  scheduleMaintenance,
  setReservation,
  windowFormError,
} from './live-operations';

type Dialog =
  | { kind: 'maintenance'; workerId: string }
  | { kind: 'cancel'; window: MaintenanceWindow }
  | { kind: 'reserve'; workerId: string }
  | { kind: 'release'; workerId: string };

const when = (iso: string | null) =>
  iso
    ? new Date(iso)
        .toISOString()
        .replace('T', ' ')
        .replace(/:\d\d\.\d+Z$/, ' UTC')
    : 'No end';
const toIso = (local: string) => {
  const d = new Date(local);
  return Number.isFinite(d.getTime()) ? d.toISOString() : '';
};

export function LiveOperationsPage({
  baseUrl,
  token,
  authRecovery,
  workerIds,
  operations,
  loadError,
  onOperations,
}: {
  baseUrl: string;
  token: string;
  authRecovery: AuthRecovery;
  workerIds: string[];
  operations: Operations | null;
  loadError: string | null;
  onOperations: (value: Operations) => void;
}) {
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const opts = { recovery: authRecovery };
  const open = (next: Dialog, event: { currentTarget: HTMLElement }) => {
    returnFocus.current = event.currentTarget;
    setError(null);
    setDialog(next);
  };
  const run = async (action: () => Promise<Operations>, done: string) => {
    setBusy(true);
    setError(null);
    try {
      onOperations(await action());
      setNotice(done);
      setDialog(null);
    } catch (cause) {
      setError(operationsErrorMessage(cause, 'edit'));
    } finally {
      setBusy(false);
    }
  };
  const refresh = async () => {
    try {
      onOperations(await loadOperations(baseUrl, token, opts));
      setNotice('Operations refreshed.');
    } catch (cause) {
      setNotice(operationsErrorMessage(cause));
    }
  };
  const reservationFor = (id: string) => operations?.reservations.find((r) => r.workerId === id);
  const windowsFor = (id: string) =>
    operations?.maintenance.filter(
      (w) => w.workerId === id && (w.status === 'ACTIVE' || w.status === 'SCHEDULED'),
    ) ?? [];

  return (
    <section className="incidents-page">
      <div className="live-intro incidents-intro">
        <div>
          <span className="eyebrow">OPERATOR RECORDS</span>
          <h2>Operations</h2>
          <p>
            A <strong>maintenance window</strong> silences alerts for one worker while it runs: no
            new incidents, escalations or emails. Data is still collected, and the page stays honest
            about it. A <strong>reservation</strong> is a note saying who has a worker; it does not
            change job routing. Draining and the Actions tab are separate. Every change needs a
            reason and is audited (SUPER_ADMIN to edit).
          </p>
        </div>
        <button className="button-secondary" type="button" onClick={() => void refresh()}>
          Refresh
        </button>
      </div>
      {loadError && (
        <div className="permission-panel" role="alert">
          {loadError}
        </div>
      )}
      <div role="status" className="process-feedback">
        {notice}
      </div>
      {operations && (
        <>
          <div className="section-title">
            <h3>Workers</h3>
          </div>
          <div className="table-wrap incident-table-wrap">
            <table className="incident-table">
              <thead>
                <tr>
                  <th>Worker</th>
                  <th>Alerts</th>
                  <th>Reservation note</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {workerIds.map((id) => {
                  const live = windowsFor(id);
                  const active = live.find((w) => w.status === 'ACTIVE');
                  const next = live.find((w) => w.status === 'SCHEDULED');
                  const r = reservationFor(id);
                  const expired = r?.until != null && Date.parse(r.until) <= Date.now();
                  return (
                    <tr key={id}>
                      <th scope="row">{id}</th>
                      <td>
                        {active ? (
                          <>
                            <strong className="text-warning">
                              Silenced until {when(active.endsAt)}
                            </strong>
                            <small>{active.reason}</small>
                          </>
                        ) : next ? (
                          <>
                            Active
                            <small>
                              Maintenance {when(next.startsAt)} → {when(next.endsAt)}
                            </small>
                          </>
                        ) : (
                          'Active'
                        )}
                      </td>
                      <td>
                        {r ? (
                          <>
                            {r.owner}: {r.reason}
                            <small>
                              {expired ? 'Ended ' : 'Until '}
                              {when(r.until)}
                              {expired ? ' (still recorded; release it)' : ''}
                            </small>
                          </>
                        ) : (
                          <span className="muted">None</span>
                        )}
                      </td>
                      <td className="process-actions">
                        <button
                          type="button"
                          className="action-secondary"
                          onClick={(e) => open({ kind: 'maintenance', workerId: id }, e)}
                        >
                          Schedule maintenance
                        </button>
                        <button
                          type="button"
                          className="action-secondary"
                          onClick={(e) =>
                            open(
                              r
                                ? { kind: 'release', workerId: id }
                                : { kind: 'reserve', workerId: id },
                              e,
                            )
                          }
                        >
                          {r ? 'Release reservation' : 'Reserve'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="section-title">
            <h3>Maintenance windows (last 30 days)</h3>
          </div>
          {operations.maintenance.length === 0 ? (
            <div className="panel incident-empty">
              <h3>No maintenance windows</h3>
              <p>Schedule one from the table above before planned work on a worker.</p>
            </div>
          ) : (
            <div className="table-wrap incident-table-wrap">
              <table className="incident-table">
                <thead>
                  <tr>
                    <th>Worker</th>
                    <th>Status</th>
                    <th>Window</th>
                    <th>Owner and reason</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {operations.maintenance.map((w) => (
                    <tr key={w.id}>
                      <th scope="row">{w.workerId}</th>
                      <td>{w.status}</td>
                      <td>
                        {when(w.startsAt)} → {when(w.endsAt)}
                      </td>
                      <td>
                        {w.owner}: {w.reason}
                      </td>
                      <td>
                        {(w.status === 'SCHEDULED' || w.status === 'ACTIVE') && (
                          <button
                            type="button"
                            className="action-secondary"
                            onClick={(e) => open({ kind: 'cancel', window: w }, e)}
                          >
                            {w.status === 'ACTIVE' ? 'End now' : 'Cancel'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {dialog && (
        <AccessibleDialog
          title={
            dialog.kind === 'maintenance'
              ? `Schedule maintenance · ${dialog.workerId}`
              : dialog.kind === 'cancel'
                ? `${dialog.window.status === 'ACTIVE' ? 'End' : 'Cancel'} maintenance · ${dialog.window.workerId}`
                : dialog.kind === 'reserve'
                  ? `Reserve · ${dialog.workerId}`
                  : `Release reservation · ${dialog.workerId}`
          }
          onClose={() => setDialog(null)}
          returnFocusRef={returnFocus}
        >
          <OperationsForm
            key={`${dialog.kind}:${dialog.kind === 'cancel' ? dialog.window.id : dialog.workerId}`}
            dialog={dialog}
            busy={busy}
            error={error}
            close={() => setDialog(null)}
            submit={{
              maintenance: (input) =>
                run(
                  () => scheduleMaintenance(baseUrl, token, input, opts),
                  `Maintenance scheduled for ${input.workerId}.`,
                ),
              cancel: (id, reason) =>
                run(
                  () => cancelMaintenance(baseUrl, token, id, reason, opts),
                  'Maintenance ended.',
                ),
              reserve: (id, input) =>
                run(
                  () => setReservation(baseUrl, token, id, input, opts),
                  `Reservation note set on ${id}.`,
                ),
              release: (id, reason) =>
                run(
                  () => releaseReservation(baseUrl, token, id, reason, opts),
                  `Reservation released on ${id}.`,
                ),
            }}
          />
        </AccessibleDialog>
      )}
    </section>
  );
}

function OperationsForm({
  dialog,
  busy,
  error,
  close,
  submit,
}: {
  dialog: Dialog;
  busy: boolean;
  error: string | null;
  close: () => void;
  submit: {
    maintenance: (input: {
      workerId: string;
      startsAt: string;
      endsAt: string;
      owner: string;
      reason: string;
    }) => Promise<void>;
    cancel: (id: string, reason: string) => Promise<void>;
    reserve: (
      id: string,
      input: { owner: string; until: string | null; reason: string },
    ) => Promise<void>;
    release: (id: string, reason: string) => Promise<void>;
  };
}) {
  const [owner, setOwner] = useState('');
  const [reason, setReason] = useState('');
  const [from, setFrom] = useState('');
  const [until, setUntil] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setProblem(null);
    const why = reason.trim();
    if (why.length < 3 || why.length > 300)
      return setProblem('Give a reason of 3 to 300 characters.');
    if (dialog.kind === 'cancel') return void submit.cancel(dialog.window.id, why);
    if (dialog.kind === 'release') return void submit.release(dialog.workerId, why);
    if (!owner.trim()) return setProblem('Say who this is for.');
    if (dialog.kind === 'maintenance') {
      const startsAt = toIso(from);
      const endsAt = toIso(until);
      const bad = windowFormError(startsAt, endsAt, Date.now());
      if (bad) return setProblem(bad);
      return void submit.maintenance({
        workerId: dialog.workerId,
        startsAt,
        endsAt,
        owner: owner.trim(),
        reason: why,
      });
    }
    const end = until === '' ? null : toIso(until);
    if (end !== null && Date.parse(end) <= Date.now())
      return setProblem('Reservation end must be in the future.');
    return void submit.reserve(dialog.workerId, { owner: owner.trim(), until: end, reason: why });
  };

  return (
    <form onSubmit={onSubmit}>
      {dialog.kind === 'maintenance' && (
        <p className="notice">
          Alerts for this worker are silenced from the start to the end time (at most 14 days). It
          does not drain the worker or stop anything.
        </p>
      )}
      {dialog.kind === 'reserve' && (
        <p className="notice">A note only: job routing is not changed.</p>
      )}
      {(dialog.kind === 'maintenance' || dialog.kind === 'reserve') && (
        <label className="form-field">
          {dialog.kind === 'maintenance' ? 'Who is doing the work' : 'Reserved by'}
          <input maxLength={80} value={owner} onChange={(e) => setOwner(e.target.value)} />
        </label>
      )}
      {dialog.kind === 'maintenance' && (
        <label className="form-field">
          Starts
          <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
      )}
      {(dialog.kind === 'maintenance' || dialog.kind === 'reserve') && (
        <label className="form-field">
          {dialog.kind === 'maintenance' ? 'Ends' : 'Until (optional)'}
          <input type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} />
        </label>
      )}
      <label className="form-field">
        Reason (audited)
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={300}
          rows={3}
        />
      </label>
      {(problem || error) && (
        <div className="permission-panel" role="alert">
          {problem ?? error}
        </div>
      )}
      <div className="process-actions">
        <button type="button" className="action-secondary" onClick={close}>
          Cancel
        </button>
        <button type="submit" className="button-primary" disabled={busy}>
          {dialog.kind === 'maintenance'
            ? 'Schedule'
            : dialog.kind === 'cancel'
              ? dialog.window.status === 'ACTIVE'
                ? 'End maintenance'
                : 'Cancel maintenance'
              : dialog.kind === 'reserve'
                ? 'Save note'
                : 'Release'}
        </button>
      </div>
    </form>
  );
}
