import type { ReactNode } from 'react';
import { useState } from 'react';
import type { FleetSnapshot } from './contracts';
import type { WorkspaceManager } from './Workspace';
import { draftInventoryError } from './workspace-demo';
import { Actions, AuditFields, Choices, DemoModal, demoEntry, fullTime } from './workspace-ui';

type EditTarget = { kind: 'HOST' | 'GPU' | 'WORKER' | 'RESOLUTION'; id: string };
export function InventoryEditor({
  manager,
  data,
  renderPreview,
}: {
  manager: WorkspaceManager;
  data: FleetSnapshot;
  renderPreview: (draft: FleetSnapshot) => ReactNode;
}) {
  const [editing, setEditing] = useState<EditTarget | null>(null);
  const [reset, setReset] = useState(false);
  const [actor, setActor] = useState('Demo operator');
  const [note, setNote] = useState('');
  const [notice, setNotice] = useState('');
  const { state, dispatch } = manager;
  const preview = { ...data, hosts: state.hosts, gpus: state.gpus, workers: state.workers };
  return (
    <>
      <section className="panel">
        <div className="panel-heading">
          <h2>Inventory draft editor</h2>
          <button type="button" className="action-secondary" onClick={() => setReset(true)}>
            Reset inventory draft
          </button>
        </div>
        <p className="notice">
          Draft mappings and rental metadata are browser-only. Original fleet identity and telemetry
          remain unchanged. Reconciliation below is recomputed for this draft; investigation notes
          never hide unresolved coverage gaps.
        </p>
        <div role="status" className="process-feedback">
          {notice}
        </div>
        <div className="editor-records">
          {state.hosts.map((host) => (
            <article key={host.id}>
              <strong>
                {host.label} · {host.id}
              </strong>
              <div className="process-actions">
                <button
                  type="button"
                  className="action-secondary"
                  onClick={() => setEditing({ kind: 'HOST', id: host.id })}
                >
                  Edit host
                </button>
                <button
                  type="button"
                  className="action-secondary"
                  onClick={() => setEditing({ kind: 'RESOLUTION', id: host.id })}
                >
                  Record reconciliation
                </button>
              </div>
              {state.resolutions[host.id] && (
                <small>
                  Review: {state.resolutions[host.id].owner} ·{' '}
                  {fullTime(state.resolutions[host.id].at)} · {state.resolutions[host.id].note}
                </small>
              )}
            </article>
          ))}
          {state.gpus.map((gpu) => (
            <article key={gpu.id}>
              <strong>
                {gpu.id} · {gpu.model ?? 'Model unknown'}
              </strong>
              <button
                type="button"
                className="action-secondary"
                onClick={() => setEditing({ kind: 'GPU', id: gpu.id })}
              >
                Edit GPU
              </button>
            </article>
          ))}
          {state.workers.map((worker) => (
            <article key={worker.workerId}>
              <strong>
                {worker.workerId} → {worker.hostId} / {worker.gpuId}
              </strong>
              <button
                type="button"
                className="action-secondary"
                onClick={() => setEditing({ kind: 'WORKER', id: worker.workerId })}
              >
                Edit mapping
              </button>
            </article>
          ))}
        </div>
      </section>
      <span className="eyebrow">DRAFT RECONCILIATION · NOT LIVE INVENTORY</span>
      {renderPreview(preview)}
      {editing && (
        <InventoryForm
          key={`${editing.kind}-${editing.id}`}
          target={editing}
          manager={manager}
          close={() => setEditing(null)}
          saved={(message) => setNotice(message)}
        />
      )}
      {reset && (
        <DemoModal title="Reset inventory draft?" close={() => setReset(false)}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!actor.trim() || !note.trim()) return;
              dispatch({
                type: 'RESET_INVENTORY',
                data,
                entry: demoEntry('inventory', 'RESET_INVENTORY', actor, note),
              });
              setReset(false);
              setNote('');
              setNotice(
                'Inventory draft restored. Original observations and other previews unchanged.',
              );
            }}
          >
            <p>
              Restore synthetic hosts, GPUs and mappings. Draft review annotations are cleared;
              activity history retains the reset.
            </p>
            <AuditFields actor={actor} note={note} setActor={setActor} setNote={setNote} />
            <Actions
              close={() => setReset(false)}
              label="Reset demo inventory"
              disabled={!actor.trim() || !note.trim()}
            />
          </form>
        </DemoModal>
      )}
    </>
  );
}
function InventoryForm({
  target,
  manager,
  close,
  saved,
}: {
  target: EditTarget;
  manager: WorkspaceManager;
  close: () => void;
  saved: (message: string) => void;
}) {
  const { state, dispatch } = manager;
  const host = state.hosts.find((item) => item.id === target.id);
  const gpu = state.gpus.find((item) => item.id === target.id);
  const worker = state.workers.find((item) => item.workerId === target.id);
  const [name, setName] = useState(host?.label ?? gpu?.model ?? '');
  const [provider, setProvider] = useState(host?.provider ?? '');
  const [cost, setCost] = useState(host?.monthlyCostUsd?.toString() ?? '');
  const [rental, setRental] = useState(
    host?.rented === null ? 'UNKNOWN' : host?.rented ? 'YES' : 'NO',
  );
  const [verified, setVerified] = useState(host?.inventoryVerified ?? false);
  const [hostId, setHostId] = useState(worker?.hostId ?? gpu?.hostId ?? state.hosts[0]?.id ?? '');
  const [gpuId, setGpuId] = useState(worker?.gpuId ?? '');
  const [vram, setVram] = useState(gpu?.vramTotalMb?.toString() ?? '');
  const [active, setActive] = useState(worker?.active ?? false);
  const [registered, setRegistered] = useState(worker?.inRegistry ?? false);
  const [actor, setActor] = useState('Demo operator');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  return (
    <DemoModal
      title={`${target.kind === 'RESOLUTION' ? 'Record reconciliation' : `Edit ${target.kind.toLowerCase()}`} · ${target.id}`}
      close={close}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!actor.trim() || !note.trim()) return;
          const entry = demoEntry(
            target.id,
            target.kind === 'RESOLUTION' ? 'RECONCILIATION_NOTE' : `EDIT_${target.kind}`,
            actor,
            note,
          );
          if (target.kind === 'RESOLUTION') dispatch({ type: 'RESOLUTION', id: target.id, entry });
          else {
            const draft = structuredClone({
              hosts: state.hosts,
              gpus: state.gpus,
              workers: state.workers,
            });
            if (target.kind === 'HOST')
              draft.hosts = draft.hosts.map((item) =>
                item.id === target.id
                  ? {
                      ...item,
                      label: name.trim(),
                      provider: provider.trim() || null,
                      monthlyCostUsd: cost.trim() ? Number(cost) : null,
                      rented: rental === 'UNKNOWN' ? null : rental === 'YES',
                      inventoryVerified: verified,
                    }
                  : item,
              );
            if (target.kind === 'GPU') {
              draft.gpus = draft.gpus.map((item) =>
                item.id === target.id
                  ? {
                      ...item,
                      model: name.trim() || null,
                      hostId,
                      vramTotalMb: vram.trim() ? Number(vram) : null,
                    }
                  : item,
              );
              draft.workers = draft.workers.map((item) =>
                item.gpuId === target.id ? { ...item, hostId } : item,
              );
            }
            if (target.kind === 'WORKER')
              draft.workers = draft.workers.map((item) =>
                item.workerId === target.id
                  ? { ...item, hostId, gpuId, active, inRegistry: registered }
                  : item,
              );
            const invalid = draftInventoryError(draft);
            if (invalid) {
              setError(invalid);
              return;
            }
            dispatch({ type: 'INVENTORY', draft, entry });
          }
          saved(
            'Inventory preview updated in browser memory. No registry, billing or monitoring changed.',
          );
          close();
        }}
      >
        {target.kind === 'HOST' && (
          <>
            <label className="form-field">
              Host label
              <input
                required
                maxLength={80}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className="form-field">
              Provider
              <input
                maxLength={80}
                value={provider}
                onChange={(event) => setProvider(event.target.value)}
                placeholder="Blank means unknown"
              />
            </label>
            <label className="form-field">
              Monthly rental cost (USD)
              <input
                type="number"
                min={0}
                step="0.01"
                value={cost}
                onChange={(event) => setCost(event.target.value)}
                placeholder="Blank means unknown"
              />
            </label>
            <Choices
              label="Rented"
              value={rental}
              change={setRental}
              options={['YES', 'NO', 'UNKNOWN'].map((value) => ({ value, label: value }))}
            />
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={verified}
                onChange={(event) => setVerified(event.target.checked)}
              />
              Inventory reviewed in this draft
            </label>
          </>
        )}
        {target.kind === 'GPU' && (
          <>
            <label className="form-field">
              GPU model
              <input
                maxLength={80}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Blank means unknown"
              />
            </label>
            <label className="form-field">
              VRAM total (MB)
              <input
                type="number"
                min={1}
                step={1}
                value={vram}
                onChange={(event) => setVram(event.target.value)}
                placeholder="Blank means unknown"
              />
            </label>
            <Choices
              label="Host"
              value={hostId}
              options={state.hosts.map((item) => ({ value: item.id, label: item.label }))}
              change={setHostId}
            />
            <p className="notice">
              Moving this GPU in the draft also moves its mapped logical workers. Observed process
              assignments and telemetry do not move.
            </p>
          </>
        )}
        {target.kind === 'WORKER' && (
          <>
            <Choices
              label="Host"
              value={hostId}
              options={state.hosts.map((item) => ({ value: item.id, label: item.label }))}
              change={(value) => {
                setHostId(value);
                setGpuId(state.gpus.find((item) => item.hostId === value)?.id ?? '');
              }}
            />
            <Choices
              label="GPU"
              value={gpuId}
              options={state.gpus
                .filter((item) => item.hostId === hostId)
                .map((item) => ({
                  value: item.id,
                  label: `${item.id} · ${item.model ?? 'Unknown model'}`,
                }))}
              change={setGpuId}
            />
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={active}
                onChange={(event) => setActive(event.target.checked)}
              />
              Active in draft
            </label>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={registered}
                onChange={(event) => setRegistered(event.target.checked)}
              />
              In registry in draft
            </label>
            <p className="notice">
              This edits inventory assumptions only; it does not register a worker, relocate a
              process or alter live routing.
            </p>
          </>
        )}
        {target.kind === 'RESOLUTION' && (
          <p>
            Record an owner and investigation/resolution note. Existing exporter gaps remain visible
            until observations change. Recording a note never certifies a host healthy.
          </p>
        )}
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
