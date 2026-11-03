import { useEffect, useReducer, useRef, useState } from 'react';
import type { FleetSnapshot } from './contracts';
import { fixtureSnapshot } from './fixtures';
import type { DemoInstance, ProcessAction } from './process-demo';
import { canSimulate, creationError, processReducer, seedProcesses } from './process-demo';

export function useProcessDemo() {
  const [state, dispatch] = useReducer(processReducer, fixtureSnapshot, seedProcesses);
  useEffect(() => {
    const timers = state.instances
      .filter((instance) => instance.pending)
      .map((instance) =>
        setTimeout(
          () =>
            dispatch({
              type: 'COMPLETE',
              id: instance.id,
              at: new Date().toISOString(),
              eventId: crypto.randomUUID(),
            }),
          900,
        ),
      );
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, [state.instances]);
  return { state, dispatch };
}
export type ProcessManager = ReturnType<typeof useProcessDemo>;
const labels: Record<ProcessAction, string> = {
  START: 'Start',
  STOP: 'Graceful stop',
  RESTART: 'Restart',
  KILL: 'Force kill',
};

export function ProcessControls({
  manager,
  data,
  workerId,
}: {
  manager: ProcessManager;
  data: FleetSnapshot;
  workerId?: string;
}) {
  const { state, dispatch } = manager;
  const [confirmation, setConfirmation] = useState<{
    instance: DemoInstance;
    action: ProcessAction;
  } | null>(null);
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [notice, setNotice] = useState('');
  const [typedName, setTypedName] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const isOpen = Boolean(confirmation || creating || resetting);
  useEffect(() => {
    if (isOpen) dialog.current?.showModal();
    else dialog.current?.close();
  }, [isOpen]);
  const close = () => {
    setConfirmation(null);
    setCreating(false);
    setResetting(false);
    setTypedName('');
  };
  const shown = state.instances.filter((instance) => !workerId || instance.workerId === workerId);
  const target = confirmation
    ? state.instances.find((instance) => instance.id === confirmation.instance.id)
    : null;
  const impactedWorker = target
    ? data.workers.find((worker) => worker.workerId === target.workerId)
    : null;
  const siblings = target
    ? state.instances.filter(
        (instance) => instance.gpuId === target.gpuId && instance.id !== target.id,
      )
    : [];
  const history = state.history.filter(
    (entry) => !workerId || shown.some((instance) => instance.name === entry.instance),
  );
  const confirm = () => {
    if (!confirmation || !target || !canSimulate(target, confirmation.action)) return;
    dispatch({
      type: 'REQUEST',
      id: target.id,
      action: confirmation.action,
      at: new Date().toISOString(),
      eventId: crypto.randomUUID(),
    });
    setNotice(
      `${labels[confirmation.action]} simulated for ${target.name}. Demo only—no command executed.`,
    );
    close();
  };
  return (
    <section className="panel process-controls">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">BROWSER-ONLY SIMULATION</span>
          <h2>ComfyUI instances</h2>
        </div>
        <div className="process-actions">
          <button type="button" className="action-secondary" onClick={() => setResetting(true)}>
            Reset demo
          </button>
          <button type="button" className="action-primary" onClick={() => setCreating(true)}>
            + Create instance
          </button>
        </div>
      </div>
      <p className="notice">
        Demo only—no command executed. Changes affect this browser session’s process preview. Fleet
        observations, jobs and incidents remain the frozen fixtures. Reloading resets this preview.
      </p>
      <div role="status" className="process-feedback">
        {notice}
      </div>
      <div className="instance-list">
        {shown.map((instance) => (
          <article className="instance-row" key={instance.id}>
            <div>
              <h3>{instance.name}</h3>
              <small>
                {instance.hostId} → {instance.gpuId} · Port {instance.port} · {instance.profile}
              </small>
              <small>
                {instance.workerId
                  ? `Linked fixture: ${instance.workerId}`
                  : 'Draft instance · not registered as a worker'}
              </small>
            </div>
            <div className="instance-state">
              <span
                className={`badge ${instance.status === 'RUNNING' ? 'good' : instance.pending ? 'warning' : 'neutral'}`}
              >
                {instance.status} · SIMULATED
              </span>
              {instance.status === 'UNKNOWN' && <small>State unknown; actions unavailable.</small>}
            </div>
            <div className="process-actions">
              {(Object.keys(labels) as ProcessAction[]).map((action) => (
                <button
                  type="button"
                  key={action}
                  disabled={!canSimulate(instance, action)}
                  className={action === 'KILL' ? 'action-danger' : 'action-secondary'}
                  onClick={() => {
                    setTypedName('');
                    setConfirmation({ instance, action });
                  }}
                >
                  {labels[action]}
                </button>
              ))}
            </div>
          </article>
        ))}
      </div>
      {shown.length === 0 && (
        <p className="empty compact">No preview instances linked to this worker.</p>
      )}
      <details className="simulation-history">
        <summary>Simulation history ({history.length})</summary>
        {history.length === 0 ? (
          <p className="muted">No simulated actions yet.</p>
        ) : (
          <ol className="audit">
            {history.map((entry) => (
              <li key={entry.id}>
                <small>{new Date(entry.at).toISOString()} · Browser demo</small>
                <p>
                  <strong>
                    {entry.instance} · {entry.action}
                  </strong>
                </p>
                <p>{entry.detail}</p>
              </li>
            ))}
          </ol>
        )}
      </details>
      <dialog
        ref={dialog}
        className="process-dialog"
        onCancel={close}
        onClose={close}
        aria-labelledby="process-dialog-title"
      >
        {creating ? (
          <CreateInstance
            data={data}
            manager={manager}
            workerId={workerId}
            close={close}
            created={(name) =>
              setNotice(
                `${name} created in the demo, stopped and unregistered. No command executed.`,
              )
            }
          />
        ) : resetting ? (
          <>
            <span className="eyebrow">LOCAL PREVIEW ONLY</span>
            <h2 id="process-dialog-title">Reset process demo?</h2>
            <p>
              This clears all simulated instances and action history and restores the initial
              preview. Fleet fixtures are unaffected.
            </p>
            <div className="dialog-actions">
              <button type="button" className="action-secondary" onClick={close}>
                Cancel
              </button>
              <button
                type="button"
                className="action-primary"
                onClick={() => {
                  dispatch({ type: 'RESET', snapshot: data });
                  setNotice('Process preview reset. No command executed.');
                  close();
                }}
              >
                Reset simulation
              </button>
            </div>
          </>
        ) : confirmation && target ? (
          <>
            <span className="eyebrow">DEMO ONLY · NO COMMAND EXECUTED</span>
            <h2 id="process-dialog-title">
              {labels[confirmation.action]} {target.name}?
            </h2>
            <p>
              {confirmation.action === 'KILL'
                ? 'Force kill skips graceful draining. In a live implementation, running work could be interrupted.'
                : confirmation.action === 'START'
                  ? 'Preview starting this instance using its approved profile.'
                  : 'Preview draining owned work before stopping the instance. Restart returns it to RUNNING after the simulated drain.'}
            </p>
            <dl>
              <dt>Host / GPU</dt>
              <dd>
                {target.hostId} / {target.gpuId}
              </dd>
              <dt>Port / profile</dt>
              <dd>
                {target.port} / {target.profile}
              </dd>
              <dt>Fixture queue</dt>
              <dd>
                {impactedWorker
                  ? `${impactedWorker.comfy.running ?? 'Unknown'} running · ${impactedWorker.comfy.pending ?? 'Unknown'} pending`
                  : 'No registered worker'}
              </dd>
            </dl>
            {siblings.length > 0 && (
              <p className="notice">
                Shared GPU with {siblings.map((instance) => instance.name).join(', ')}. Only the
                selected preview instance changes; real capacity and isolation are unverified.
              </p>
            )}
            {impactedWorker?.activeIncident && (
              <p className="notice">
                Fixture incident {impactedWorker.activeIncident.id} is active. A live action would
                require evidence review and separate authorization.
              </p>
            )}
            {confirmation.action === 'KILL' && (
              <label className="form-field">
                Type {target.name} to confirm the simulation
                <input
                  value={typedName}
                  onChange={(event) => setTypedName(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
            )}
            <div className="dialog-actions">
              <button type="button" className="action-secondary" onClick={close}>
                Cancel
              </button>
              <button
                type="button"
                className={confirmation.action === 'KILL' ? 'action-danger' : 'action-primary'}
                disabled={
                  !canSimulate(target, confirmation.action) ||
                  (confirmation.action === 'KILL' && typedName !== target.name)
                }
                onClick={confirm}
              >
                Simulate {labels[confirmation.action].toLowerCase()}
              </button>
            </div>
          </>
        ) : null}
      </dialog>
    </section>
  );
}
function CreateInstance({
  data,
  manager,
  workerId,
  close,
  created,
}: {
  data: FleetSnapshot;
  manager: ProcessManager;
  workerId?: string;
  close: () => void;
  created: (name: string) => void;
}) {
  const selected = data.workers.find((worker) => worker.workerId === workerId);
  const [name, setName] = useState('');
  const [hostId, setHostId] = useState(selected?.hostId ?? data.hosts[0]?.id ?? '');
  const [gpuId, setGpuId] = useState(
    selected?.gpuId ?? data.gpus.find((gpu) => gpu.hostId === hostId)?.id ?? '',
  );
  const [port, setPort] = useState('8190');
  const [profile, setProfile] = useState<DemoInstance['profile']>('Standard');
  const [submitted, setSubmitted] = useState(false);
  const draft = { name: name.trim(), hostId, gpuId, port: Number(port) };
  const error = creationError(draft, manager.state, data);
  const shared = manager.state.instances.filter((instance) => instance.gpuId === gpuId);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
        if (error) return;
        manager.dispatch({
          type: 'CREATE',
          instance: {
            ...draft,
            id: crypto.randomUUID(),
            workerId: null,
            profile,
            status: 'STOPPED',
            pending: null,
          },
          at: new Date().toISOString(),
          eventId: crypto.randomUUID(),
        });
        created(draft.name);
        close();
      }}
    >
      <span className="eyebrow">DEMO ONLY · NO COMMAND EXECUTED</span>
      <h2 id="process-dialog-title">Create ComfyUI instance</h2>
      <p>
        Create a stopped, unregistered preview instance. No process, port or GPU resource is
        allocated.
      </p>
      <label className="form-field">
        Instance name
        <input
          required
          minLength={2}
          maxLength={48}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. workflow-preview"
          autoComplete="off"
        />
      </label>
      <fieldset className="choice-field">
        <legend>Host</legend>
        <div className="choice-grid">
          {data.hosts.map((host) => (
            <label key={host.id}>
              <input
                type="radio"
                name="instance-host"
                checked={hostId === host.id}
                onChange={() => {
                  setHostId(host.id);
                  setGpuId(data.gpus.find((gpu) => gpu.hostId === host.id)?.id ?? '');
                }}
              />
              {host.label} <small>{host.id}</small>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="choice-field">
        <legend>Physical GPU</legend>
        <div className="choice-grid">
          {data.gpus
            .filter((gpu) => gpu.hostId === hostId)
            .map((gpu) => (
              <label key={gpu.id}>
                <input
                  type="radio"
                  name="instance-gpu"
                  checked={gpuId === gpu.id}
                  onChange={() => setGpuId(gpu.id)}
                />
                {gpu.id}
                <small>{gpu.model ?? 'Model unknown'}</small>
              </label>
            ))}
        </div>
      </fieldset>
      <label className="form-field">
        Port
        <input
          required
          type="number"
          min={1024}
          max={65535}
          step={1}
          value={port}
          onChange={(event) => setPort(event.target.value)}
        />
      </label>
      <fieldset className="choice-field">
        <legend>Approved demo profile</legend>
        <div className="choice-grid">
          {(['Standard', 'Low VRAM'] as const).map((value) => (
            <label key={value}>
              <input
                type="radio"
                name="instance-profile"
                checked={profile === value}
                onChange={() => setProfile(value)}
              />
              {value}
            </label>
          ))}
        </div>
      </fieldset>
      {shared.length > 0 && (
        <p className="notice">
          GPU shared with {shared.map((instance) => instance.name).join(', ')}. VRAM availability is
          unverified; this preview does not reserve capacity.
        </p>
      )}
      {submitted && error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button type="button" className="action-secondary" onClick={close}>
          Cancel
        </button>
        <button type="submit" className="action-primary">
          Create demo instance
        </button>
      </div>
    </form>
  );
}
