import { type FormEvent, useRef, useState } from 'react';
import { AccessibleDialog } from './AccessibleDialog';
import type { AuthRecovery } from './auth';
import {
  addHostReview,
  deleteGpu,
  deleteHost,
  type Inventory,
  type InventoryGpu,
  type InventoryHost,
  inventoryErrorMessage,
  loadInventory,
  mapWorker,
  saveGpu,
  saveHost,
} from './live-inventory';

type Dialog =
  | { kind: 'host'; host: InventoryHost | null }
  | { kind: 'gpu'; gpu: InventoryGpu | null }
  | { kind: 'map'; workerId: string }
  | { kind: 'review'; host: InventoryHost }
  | { kind: 'delete'; what: 'host' | 'gpu'; id: string };

const ID_RE = /^[a-z0-9][a-z0-9-]{0,48}$/;
const usd = (n: number | null) =>
  n === null ? 'Unknown' : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

export function LiveInventoryPage({
  baseUrl,
  token,
  authRecovery,
  inventory,
  loadError,
  onInventory,
}: {
  baseUrl: string;
  token: string;
  authRecovery: AuthRecovery;
  inventory: Inventory | null;
  loadError: string | null;
  onInventory: (value: Inventory) => void;
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
  const run = async (action: () => Promise<Inventory>, done: string) => {
    setBusy(true);
    setError(null);
    try {
      onInventory(await action());
      setNotice(done);
      setDialog(null);
    } catch (cause) {
      setError(inventoryErrorMessage(cause, 'edit'));
    } finally {
      setBusy(false);
    }
  };
  const refresh = async () => {
    try {
      onInventory(await loadInventory(baseUrl, token, opts));
      setNotice('Inventory refreshed.');
    } catch (cause) {
      setNotice(inventoryErrorMessage(cause));
    }
  };

  const hostLabel = (id: string | null) =>
    id === null ? '—' : (inventory?.hosts.find((h) => h.id === id)?.label ?? id);
  return (
    <section className="incidents-page">
      <div className="live-intro incidents-intro">
        <div>
          <span className="eyebrow">OPERATOR RECORDS</span>
          <h2>Inventory</h2>
          <p>
            Which box and GPU each worker runs on, and what the box costs. Maintained by operators
            (SUPER_ADMIN to edit); every change needs a reason and is audited. Observed telemetry is
            never overwritten by what is written here.
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
      {inventory && (
        <>
          <div className="section-title">
            <h3>Hosts</h3>
            <button
              type="button"
              className="button-secondary"
              onClick={(e) => open({ kind: 'host', host: null }, e)}
            >
              Add host
            </button>
          </div>
          {inventory.hosts.length === 0 ? (
            <div className="panel incident-empty">
              <h3>No hosts recorded</h3>
              <p>
                Until a host is added and workers are mapped to it, the dashboard shows each worker
                on a “Host not mapped” placeholder.
              </p>
            </div>
          ) : (
            <div className="table-wrap incident-table-wrap">
              <table className="incident-table">
                <thead>
                  <tr>
                    <th>Host</th>
                    <th>Provider</th>
                    <th>Rented</th>
                    <th>Monthly cost</th>
                    <th>Verified</th>
                    <th>Latest review</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {inventory.hosts.map((h) => (
                    <tr key={h.id}>
                      <td>
                        {h.label} <small>({h.id})</small>
                      </td>
                      <td>{h.provider ?? 'Unknown'}</td>
                      <td>{h.rented === null ? 'Unknown' : h.rented ? 'Yes' : 'No'}</td>
                      <td>{usd(h.monthlyCostUsd)}</td>
                      <td>{h.inventoryVerified ? 'Yes' : 'No'}</td>
                      <td>
                        {h.latestReview
                          ? `${h.latestReview.note} — ${h.latestReview.reviewedBy ?? 'unknown'}, ${h.latestReview.reviewedAt.slice(0, 10)}`
                          : 'None'}
                      </td>
                      <td>
                        <div className="process-actions">
                          <button
                            type="button"
                            className="action-secondary"
                            onClick={(e) => open({ kind: 'host', host: h }, e)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="action-secondary"
                            onClick={(e) => open({ kind: 'review', host: h }, e)}
                          >
                            Record review
                          </button>
                          <button
                            type="button"
                            className="action-secondary"
                            onClick={(e) => open({ kind: 'delete', what: 'host', id: h.id }, e)}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="section-title">
            <h3>GPUs</h3>
            <button
              type="button"
              className="button-secondary"
              disabled={inventory.hosts.length === 0}
              onClick={(e) => open({ kind: 'gpu', gpu: null }, e)}
            >
              Add GPU
            </button>
          </div>
          {inventory.gpus.length > 0 && (
            <div className="table-wrap incident-table-wrap">
              <table className="incident-table">
                <thead>
                  <tr>
                    <th>GPU</th>
                    <th>Host</th>
                    <th>Model</th>
                    <th>VRAM</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {inventory.gpus.map((g) => (
                    <tr key={g.id}>
                      <td>{g.id}</td>
                      <td>{hostLabel(g.hostId)}</td>
                      <td>{g.model ?? 'Unknown'}</td>
                      <td>
                        {g.vramTotalMb === null
                          ? 'Unknown'
                          : `${g.vramTotalMb.toLocaleString('en-US')} MB`}
                      </td>
                      <td>
                        <div className="process-actions">
                          <button
                            type="button"
                            className="action-secondary"
                            onClick={(e) => open({ kind: 'gpu', gpu: g }, e)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="action-secondary"
                            onClick={(e) => open({ kind: 'delete', what: 'gpu', id: g.id }, e)}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="section-title">
            <h3>Worker mapping</h3>
          </div>
          <div className="table-wrap incident-table-wrap">
            <table className="incident-table">
              <thead>
                <tr>
                  <th>Worker</th>
                  <th>Host</th>
                  <th>GPU</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {inventory.workers.map((w) => (
                  <tr key={w.workerId}>
                    <td>
                      {w.label} <small>({w.workerId})</small>
                    </td>
                    <td>{w.hostId ? hostLabel(w.hostId) : 'Not mapped'}</td>
                    <td>{w.gpuId ?? '—'}</td>
                    <td>
                      <button
                        type="button"
                        className="action-secondary"
                        onClick={(e) => open({ kind: 'map', workerId: w.workerId }, e)}
                      >
                        {w.hostId ? 'Change mapping' : 'Map'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {dialog && inventory && (
        <AccessibleDialog
          title={dialogTitle(dialog)}
          onClose={() => setDialog(null)}
          returnFocusRef={returnFocus}
        >
          <DialogBody
            dialog={dialog}
            inventory={inventory}
            busy={busy}
            error={error}
            close={() => setDialog(null)}
            submit={{
              host: (id, input) =>
                run(() => saveHost(baseUrl, token, id, input, opts), `Saved host ${id}.`),
              gpu: (id, input) =>
                run(() => saveGpu(baseUrl, token, id, input, opts), `Saved GPU ${id}.`),
              map: (workerId, target, reason) =>
                run(
                  () => mapWorker(baseUrl, token, workerId, target, reason, opts),
                  `Updated mapping for ${workerId}.`,
                ),
              review: (id, note) =>
                run(
                  () => addHostReview(baseUrl, token, id, note, opts),
                  `Review recorded for ${id}.`,
                ),
              remove: (what, id, reason) =>
                run(
                  () =>
                    what === 'host'
                      ? deleteHost(baseUrl, token, id, reason, opts)
                      : deleteGpu(baseUrl, token, id, reason, opts),
                  `Deleted ${what} ${id}.`,
                ),
            }}
          />
        </AccessibleDialog>
      )}
    </section>
  );
}

function dialogTitle(d: Dialog) {
  switch (d.kind) {
    case 'host':
      return d.host ? `Edit host ${d.host.id}` : 'Add host';
    case 'gpu':
      return d.gpu ? `Edit GPU ${d.gpu.id}` : 'Add GPU';
    case 'map':
      return `Map worker ${d.workerId}`;
    case 'review':
      return `Record review for ${d.host.label}`;
    case 'delete':
      return `Delete ${d.what} ${d.id}?`;
  }
}

type Submit = {
  host: (id: string, input: Parameters<typeof saveHost>[3]) => void;
  gpu: (id: string, input: Parameters<typeof saveGpu>[3]) => void;
  map: (
    workerId: string,
    target: { hostId: string | null; gpuId: string | null },
    reason: string,
  ) => void;
  review: (id: string, note: string) => void;
  remove: (what: 'host' | 'gpu', id: string, reason: string) => void;
};

function DialogBody({
  dialog,
  inventory,
  busy,
  error,
  close,
  submit,
}: {
  dialog: Dialog;
  inventory: Inventory;
  busy: boolean;
  error: string | null;
  close: () => void;
  submit: Submit;
}) {
  const [id, setId] = useState(
    dialog.kind === 'host'
      ? (dialog.host?.id ?? '')
      : dialog.kind === 'gpu'
        ? (dialog.gpu?.id ?? '')
        : '',
  );
  const [label, setLabel] = useState(dialog.kind === 'host' ? (dialog.host?.label ?? '') : '');
  const [provider, setProvider] = useState(
    dialog.kind === 'host' ? (dialog.host?.provider ?? '') : '',
  );
  const [rented, setRented] = useState(
    dialog.kind === 'host' && dialog.host?.rented !== null && dialog.host
      ? String(dialog.host.rented)
      : 'unknown',
  );
  const [cost, setCost] = useState(
    dialog.kind === 'host' && dialog.host?.monthlyCostUsd != null
      ? String(dialog.host.monthlyCostUsd)
      : '',
  );
  const [verified, setVerified] = useState(
    dialog.kind === 'host' ? (dialog.host?.inventoryVerified ?? false) : false,
  );
  const [hostId, setHostId] = useState(
    dialog.kind === 'gpu'
      ? (dialog.gpu?.hostId ?? inventory.hosts[0]?.id ?? '')
      : dialog.kind === 'map'
        ? (inventory.workers.find((w) => w.workerId === dialog.workerId)?.hostId ?? '')
        : '',
  );
  const [gpuId, setGpuId] = useState(
    dialog.kind === 'map'
      ? (inventory.workers.find((w) => w.workerId === dialog.workerId)?.gpuId ?? '')
      : '',
  );
  const [model, setModel] = useState(dialog.kind === 'gpu' ? (dialog.gpu?.model ?? '') : '');
  const [vram, setVram] = useState(
    dialog.kind === 'gpu' && dialog.gpu?.vramTotalMb != null ? String(dialog.gpu.vramTotalMb) : '',
  );
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setProblem(null);
    const why = reason.trim();
    if (dialog.kind === 'review') {
      if (note.trim().length < 3) return setProblem('Write at least 3 characters.');
      return submit.review(dialog.host.id, note.trim());
    }
    if (why.length < 3 || why.length > 300)
      return setProblem('Give a reason of 3 to 300 characters.');
    if (dialog.kind === 'delete') return submit.remove(dialog.what, dialog.id, why);
    if (dialog.kind === 'map') {
      const unmap = hostId === '';
      if (!unmap && gpuId === '')
        return setProblem('Choose a GPU on that host, or choose no host to unmap.');
      return submit.map(
        dialog.workerId,
        unmap ? { hostId: null, gpuId: null } : { hostId, gpuId },
        why,
      );
    }
    if (dialog.kind === 'host') {
      const slug = dialog.host?.id ?? id.trim();
      if (!ID_RE.test(slug))
        return setProblem('Host id: lowercase letters, digits and hyphens only (max 49).');
      if (!label.trim()) return setProblem('A host name is required.');
      const money = cost.trim() === '' ? null : Number(cost);
      if (
        money !== null &&
        (!Number.isFinite(money) ||
          money < 0 ||
          Math.abs(money * 100 - Math.round(money * 100)) > 1e-6)
      )
        return setProblem(
          'Monthly cost must be blank or a non-negative amount with at most two decimals.',
        );
      return submit.host(slug, {
        label: label.trim(),
        provider: provider.trim() === '' ? null : provider.trim(),
        rented: rented === 'unknown' ? null : rented === 'true',
        monthlyCostUsd: money,
        inventoryVerified: verified,
        reason: why,
      });
    }
    const slug = dialog.gpu?.id ?? id.trim();
    if (!ID_RE.test(slug))
      return setProblem('GPU id: lowercase letters, digits and hyphens only (max 49).');
    if (!hostId) return setProblem('Choose the host this GPU is in.');
    const mb = vram.trim() === '' ? null : Number(vram);
    if (mb !== null && (!Number.isInteger(mb) || mb <= 0))
      return setProblem('VRAM must be blank or a positive whole number of MB.');
    submit.gpu(slug, {
      hostId,
      model: model.trim() === '' ? null : model.trim(),
      vramTotalMb: mb,
      reason: why,
    });
  };

  const gpusOnHost = inventory.gpus.filter((g) => g.hostId === hostId);
  return (
    <form onSubmit={onSubmit}>
      {dialog.kind === 'delete' && (
        <p>
          This removes the {dialog.what} record only. It is refused while workers, GPUs or reviews
          still reference it.
        </p>
      )}
      {dialog.kind === 'host' && (
        <>
          {!dialog.host && (
            <label className="form-field">
              Host id
              <input
                value={id}
                onChange={(e) => setId(e.target.value)}
                maxLength={49}
                placeholder="e.g. box-gpu7"
              />
            </label>
          )}
          <label className="form-field">
            Host name
            <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} />
          </label>
          <label className="form-field">
            Provider
            <input
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              maxLength={80}
              placeholder="Unknown"
            />
          </label>
          <label className="form-field">
            Rented
            <select value={rented} onChange={(e) => setRented(e.target.value)}>
              <option value="unknown">Unknown</option>
              <option value="true">Yes</option>
              <option value="false">No (owned)</option>
            </select>
          </label>
          <label className="form-field">
            Monthly cost (USD)
            <input
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              inputMode="decimal"
              placeholder="Unknown"
            />
          </label>
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={verified}
              onChange={(e) => setVerified(e.target.checked)}
            />
            Verified against the provider’s records
          </label>
        </>
      )}
      {dialog.kind === 'gpu' && (
        <>
          {!dialog.gpu && (
            <label className="form-field">
              GPU id
              <input
                value={id}
                onChange={(e) => setId(e.target.value)}
                maxLength={49}
                placeholder="e.g. gpu7-0"
              />
            </label>
          )}
          <label className="form-field">
            Host
            <select value={hostId} onChange={(e) => setHostId(e.target.value)}>
              {inventory.hosts.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.label}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            Model
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              maxLength={100}
              placeholder="Unknown"
            />
          </label>
          <label className="form-field">
            VRAM (MB)
            <input
              value={vram}
              onChange={(e) => setVram(e.target.value)}
              inputMode="numeric"
              placeholder="Unknown"
            />
          </label>
        </>
      )}
      {dialog.kind === 'map' && (
        <>
          <label className="form-field">
            Host
            <select
              value={hostId}
              onChange={(e) => {
                setHostId(e.target.value);
                setGpuId('');
              }}
            >
              <option value="">Not mapped</option>
              {inventory.hosts.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.label}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            GPU
            <select
              value={gpuId}
              onChange={(e) => setGpuId(e.target.value)}
              disabled={hostId === ''}
            >
              <option value="">{hostId === '' ? '—' : 'Choose a GPU'}</option>
              {gpusOnHost.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.id}
                  {g.model ? ` · ${g.model}` : ''}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      {dialog.kind === 'review' ? (
        <label className="form-field">
          Reconciliation note
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            rows={4}
          />
        </label>
      ) : (
        <label className="form-field">
          Reason (audited)
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={300}
            rows={3}
          />
        </label>
      )}
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
          {dialog.kind === 'delete'
            ? 'Delete'
            : dialog.kind === 'review'
              ? 'Record review'
              : 'Save'}
        </button>
      </div>
    </form>
  );
}
