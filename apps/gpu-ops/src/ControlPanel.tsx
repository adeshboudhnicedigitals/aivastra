import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibleDialog } from './AccessibleDialog';
import type { AuthRecovery } from './auth';
import {
  type CommandKind,
  cancelCommand,
  FleetAgentApiError,
  type FleetCommand,
  loadCommands,
  requestCommand,
} from './live-agent';

const ACTIONS: { kind: CommandKind; label: string; what: string; effect: string }[] = [
  {
    kind: 'clear_queue',
    label: 'Clear queue',
    what: 'Removes the prompts waiting in ComfyUI. A prompt that is already running is not touched.',
    effect:
      'Jobs whose prompt was waiting disappear from ComfyUI while the dispatcher still expects them; it fails them later and refunds the credits.',
  },
  {
    kind: 'restart_comfyui',
    label: 'Restart ComfyUI',
    what: 'Restarts the ComfyUI service on the box. Allowed only while nothing is running or waiting.',
    effect: 'ComfyUI is down for roughly a minute. Needs root on the box.',
  },
];

const label = (kind: CommandKind) => ACTIONS.find((a) => a.kind === kind)?.label ?? kind;
const live = (c: FleetCommand) => c.state === 'PENDING' || c.state === 'RUNNING';
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString() : '');

function errorText(cause: unknown): string {
  if (cause instanceof FleetAgentApiError) {
    if (cause.status === 403) return 'Only a super admin can run commands on a worker.';
    return cause.message;
  }
  return cause instanceof Error ? cause.message : 'Fleet API request failed.';
}

export function ActionsTab({
  baseUrl,
  token,
  workerId,
  isDraining,
  authRecovery,
}: {
  baseUrl: string;
  token: string;
  workerId: string;
  isDraining: boolean;
  authRecovery: AuthRecovery;
}) {
  const [commands, setCommands] = useState<FleetCommand[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<CommandKind | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const mounted = useRef(true);
  const returnFocus = useRef<HTMLButtonElement>(null);
  // StrictMode runs effect -> cleanup -> effect on mount, so the flag must be re-armed here.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const next = await loadCommands(baseUrl, token, workerId, authRecovery);
      if (!mounted.current) return;
      setCommands(next.commands);
      setLoadError(null);
    } catch (cause) {
      if (mounted.current) setLoadError(errorText(cause));
    }
  }, [baseUrl, token, workerId, authRecovery]);

  const anyLive = commands?.some(live) ?? false;
  useEffect(() => {
    void load();
    // Fast while something is waiting or running: an operator is watching for the result.
    const timer = globalThis.setInterval(() => void load(), anyLive ? 3_000 : 15_000);
    return () => globalThis.clearInterval(timer);
  }, [load, anyLive]);

  const submit = async () => {
    if (!dialog) return;
    setBusy(true);
    setMessage(null);
    try {
      await requestCommand(baseUrl, token, workerId, dialog, reason.trim(), authRecovery);
      setMessage({ ok: true, text: `${label(dialog)} requested. It runs within a few seconds.` });
      setDialog(null);
      setReason('');
      await load();
    } catch (cause) {
      // Kept inside the dialog's page, not the dialog: the server's reason is the whole answer.
      setMessage({ ok: false, text: errorText(cause) });
      setDialog(null);
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const cancel = async (id: string) => {
    try {
      await cancelCommand(baseUrl, token, id, authRecovery);
      await load();
    } catch (cause) {
      setMessage({ ok: false, text: errorText(cause) });
    }
  };

  const reasonOk = reason.trim().length >= 3 && reason.trim().length <= 300;

  return (
    <section className="actions-tab">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">OPERATOR ACTIONS</span>
          <h2>Actions on this worker</h2>
        </div>
      </div>
      <p className="muted">
        These act on the real box, so they are refused unless the worker is drained, no job holds
        it, and both the dispatcher and the agent see what ComfyUI is doing. Every request is
        audited with your reason.
      </p>
      <p role="status" className={isDraining ? 'text-good' : 'text-warning'}>
        {isDraining
          ? 'This worker is drained, so the actions below can be requested.'
          : 'This worker is not drained. Drain it first (Overview tab) so no new job arrives while an action runs.'}
      </p>
      {message && (
        <div
          className={message.ok ? 'notice' : 'permission-panel'}
          role={message.ok ? 'status' : 'alert'}
        >
          {message.text}
        </div>
      )}
      <div className="action-cards">
        {ACTIONS.map((a) => (
          <div className="panel" key={a.kind}>
            <h3>{a.label}</h3>
            <p>{a.what}</p>
            <p className="muted">{a.effect}</p>
            <button
              type="button"
              className="button-secondary"
              disabled={!isDraining || anyLive}
              title={
                !isDraining
                  ? 'Drain the worker first'
                  : anyLive
                    ? 'Another command is already waiting or running'
                    : undefined
              }
              ref={dialog === a.kind ? returnFocus : undefined}
              onClick={() => {
                setMessage(null);
                setDialog(a.kind);
              }}
            >
              {a.label}…
            </button>
          </div>
        ))}
      </div>

      <h3>Recent commands</h3>
      {loadError ? (
        <div className="permission-panel" role="alert">
          {loadError}
        </div>
      ) : !commands ? (
        <p aria-live="polite">Loading…</p>
      ) : commands.length === 0 ? (
        <p>No commands have been requested for this worker.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Action</th>
                <th>State</th>
                <th>Reason</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {commands.map((c) => (
                <tr key={c.id}>
                  <td>{when(c.requestedAt)}</td>
                  <td>{label(c.kind)}</td>
                  <td>
                    <b
                      className={
                        c.state === 'FAILED'
                          ? 'text-danger'
                          : c.state === 'SUCCEEDED'
                            ? 'text-good'
                            : ''
                      }
                    >
                      {c.state}
                    </b>
                    {c.state === 'PENDING' && (
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => void cancel(c.id)}
                      >
                        {' '}
                        Cancel
                      </button>
                    )}
                  </td>
                  <td>{c.reason}</td>
                  <td>{c.result ?? (live(c) ? 'Waiting for the box…' : '')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dialog && (
        <AccessibleDialog
          title={`${label(dialog)} on ${workerId}?`}
          onClose={() => setDialog(null)}
          returnFocusRef={returnFocus}
        >
          <p>{ACTIONS.find((a) => a.kind === dialog)?.what}</p>
          <p className="muted">{ACTIONS.find((a) => a.kind === dialog)?.effect}</p>
          <label className="login-field">
            Reason (3–300 characters, saved in the audit log)
            <textarea
              value={reason}
              maxLength={300}
              rows={3}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <div className="dialog-actions">
            <button type="button" className="button-secondary" onClick={() => setDialog(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="button-danger"
              disabled={!reasonOk || busy}
              onClick={() => void submit()}
            >
              {busy ? 'Requesting…' : label(dialog)}
            </button>
          </div>
        </AccessibleDialog>
      )}
    </section>
  );
}
