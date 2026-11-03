import { useState } from 'react';
import type { FleetSnapshot } from './contracts';
import type { ProcessManager } from './ProcessControls';
import type { DemoInstance } from './process-demo';
import { creationError } from './process-demo';
import { Actions, AuditFields, Choices, DemoModal } from './workspace-ui';

export function ConfigurationPage({
  manager,
  data,
}: {
  manager: ProcessManager;
  data: FleetSnapshot;
}) {
  const [editing, setEditing] = useState<DemoInstance | null>(null);
  const [notice, setNotice] = useState('');
  return (
    <section className="panel">
      <h2>Instance configuration</h2>
      <p className="notice">
        Edit stopped preview instances only. Running or unknown-state instances must not be
        reconfigured. Stop a running instance with the mocked controls in Operations. Changes do not
        edit files, remap the observed worker or reserve GPU capacity.
      </p>
      <div role="status" className="process-feedback">
        {notice}
      </div>
      {manager.state.instances.map((instance) => (
        <article className="instance-row" key={instance.id}>
          <div>
            <h3>{instance.name}</h3>
            <small>
              {instance.hostId} → {instance.gpuId} · :{instance.port}
            </small>
            <small>
              {instance.profile} · {instance.status} · SIMULATED
            </small>
          </div>
          <button
            type="button"
            className="action-secondary"
            disabled={instance.status !== 'STOPPED' || Boolean(instance.pending)}
            onClick={() => setEditing(instance)}
          >
            Edit configuration
          </button>
        </article>
      ))}
      {editing && (
        <ConfigurationForm
          instance={editing}
          manager={manager}
          data={data}
          close={() => setEditing(null)}
          saved={(name) =>
            setNotice(`Configuration saved for ${name} in browser memory. No command executed.`)
          }
        />
      )}
    </section>
  );
}
function ConfigurationForm({
  instance,
  manager,
  data,
  close,
  saved,
}: {
  instance: DemoInstance;
  manager: ProcessManager;
  data: FleetSnapshot;
  close: () => void;
  saved: (name: string) => void;
}) {
  const [draft, setDraft] = useState({ ...instance });
  const [port, setPort] = useState(String(instance.port));
  const [actor, setActor] = useState('Demo operator');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  return (
    <DemoModal title={`Configure ${instance.name}`} close={close}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const candidate = { ...draft, name: draft.name.trim(), port: Number(port) };
          const invalid = creationError(
            candidate,
            {
              ...manager.state,
              instances: manager.state.instances.filter((item) => item.id !== instance.id),
            },
            data,
          );
          if (invalid) {
            setError(invalid);
            return;
          }
          const current = manager.state.instances.find((item) => item.id === instance.id);
          if (current?.status !== 'STOPPED' || current.pending) {
            setError('Instance must still be stopped.');
            return;
          }
          if (!actor.trim() || !note.trim()) return;
          manager.dispatch({
            type: 'CONFIGURE',
            instance: candidate,
            actor: actor.trim(),
            reason: note.trim(),
            at: new Date().toISOString(),
            eventId: crypto.randomUUID(),
          });
          saved(candidate.name);
          close();
        }}
      >
        <p>
          Approved profiles and ports only; arbitrary shell arguments and credentials are not
          supported.
        </p>
        <label className="form-field">
          Instance name
          <input
            required
            maxLength={48}
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
        </label>
        <Choices
          label="Host"
          value={draft.hostId}
          options={data.hosts.map((host) => ({
            value: host.id,
            label: `${host.label} · ${host.id}`,
          }))}
          change={(hostId) =>
            setDraft({
              ...draft,
              hostId,
              gpuId: data.gpus.find((gpu) => gpu.hostId === hostId)?.id ?? '',
            })
          }
        />
        <Choices
          label="Physical GPU"
          value={draft.gpuId}
          options={data.gpus
            .filter((gpu) => gpu.hostId === draft.hostId)
            .map((gpu) => ({
              value: gpu.id,
              label: `${gpu.id} · ${gpu.model ?? 'Model unknown'}`,
            }))}
          change={(gpuId) => setDraft({ ...draft, gpuId })}
        />
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
        <Choices
          label="Approved profile"
          value={draft.profile}
          options={['Standard', 'Low VRAM'].map((profile) => ({ value: profile, label: profile }))}
          change={(profile) => setDraft({ ...draft, profile: profile as DemoInstance['profile'] })}
        />
        <p className="notice">
          Shared-GPU capacity and target-host readiness remain unverified. Linked worker identity is
          unchanged; this is only an instance configuration preview.
        </p>
        <AuditFields actor={actor} note={note} setActor={setActor} setNote={setNote} />
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <Actions close={close} disabled={!actor.trim() || !note.trim()} />
      </form>
    </DemoModal>
  );
}
