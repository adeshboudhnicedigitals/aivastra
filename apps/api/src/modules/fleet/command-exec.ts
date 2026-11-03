import type { FleetCommandKind } from '@aivastra/types';

// The on-box half of the control commands: the fixed scripts to run, and how to read their output.
// Nothing here is built from operator input. A script only ever receives the worker's own unit name
// and ComfyUI port, which come from our table, so there is nothing to inject into.

const QUEUE_FN = String.raw`
q() { curl -s -m 5 "http://127.0.0.1:$1/queue" 2>/dev/null | python3 -c 'import json,sys
try:
  d=json.load(sys.stdin); print(len(d["queue_running"]), len(d["queue_pending"]))
except Exception:
  print("error")'; }
`;

/** Args: <comfy port>. Clears pending prompts only; a running prompt is not touched. */
export const CLEAR_QUEUE_SCRIPT = String.raw`
export LC_ALL=C
${QUEUE_FN}
echo "before $(q "$1")"
curl -s -m 5 -o /dev/null -w "http %{http_code}\n" -X POST -H 'Content-Type: application/json' -d '{"clear":true}' "http://127.0.0.1:$1/queue" 2>/dev/null
echo "after $(q "$1")"
`;

/**
 * Args: <systemd unit> <comfy port>. Re-checks that ComfyUI is idle on the box itself, because the
 * check that allowed the request ran minutes ago, then restarts only if sudo works without a
 * password. It never prompts and never tries to escalate any other way.
 */
export const RESTART_SCRIPT = String.raw`
export LC_ALL=C
${QUEUE_FN}
b=$(q "$2"); echo "before $b"
if [ "$b" != "0 0" ]; then echo "busy"; exit 0; fi
if ! sudo -n true 2>/dev/null; then echo "sudo denied"; exit 0; fi
sudo -n systemctl restart "$1" 2>/dev/null; echo "restart exit $?"
a="error"
for i in $(seq 1 30); do sleep 2; a=$(q "$2"); [ "$a" != "error" ] && break; done
echo "after $a"
echo "active $(systemctl is-active "$1" 2>/dev/null)"
`;

export const scriptFor = (kind: FleetCommandKind) =>
  kind === 'clear_queue' ? CLEAR_QUEUE_SCRIPT : RESTART_SCRIPT;

export type CommandOutcome = { state: 'SUCCEEDED' | 'FAILED'; result: string };

function field(lines: string[], key: string): string | null {
  for (const l of lines) if (l.startsWith(`${key} `)) return l.slice(key.length + 1).trim();
  return null;
}
function pair(v: string | null): { running: number; pending: number } | null {
  const m = v ? /^(\d+) (\d+)$/.exec(v) : null;
  return m ? { running: Number(m[1]), pending: Number(m[2]) } : null;
}

/** Output of a script (or null if it could not be run at all) to a stored outcome. */
export function interpretOutput(
  kind: FleetCommandKind,
  out: string | null,
  unit: string,
): CommandOutcome {
  if (out === null) {
    return { state: 'FAILED', result: 'Could not reach the box over SSH; nothing was changed.' };
  }
  const lines = out.split('\n').map((l) => l.trim());
  const before = pair(field(lines, 'before'));

  if (kind === 'clear_queue') {
    const after = pair(field(lines, 'after'));
    if (!before || !after) {
      return {
        state: 'FAILED',
        result: 'ComfyUI did not answer on the box; the queue is unchanged.',
      };
    }
    if (field(lines, 'http') !== '200') {
      return {
        state: 'FAILED',
        result: `ComfyUI refused the clear (HTTP ${field(lines, 'http') ?? 'none'}).`,
      };
    }
    return after.pending === 0
      ? {
          state: 'SUCCEEDED',
          result: `Cleared ${before.pending} pending prompt(s). Queue now ${after.running} running, ${after.pending} pending.`,
        }
      : {
          state: 'FAILED',
          result: `Clear was sent but ${after.pending} prompt(s) are still pending.`,
        };
  }

  if (lines.includes('busy')) {
    return {
      state: 'FAILED',
      result: `ComfyUI got work after the request (${before ? `${before.running} running, ${before.pending} pending` : 'queue busy'}). Not restarted.`,
    };
  }
  if (!before) {
    return { state: 'FAILED', result: 'ComfyUI did not answer on the box; nothing was restarted.' };
  }
  if (lines.includes('sudo denied')) {
    return {
      state: 'FAILED',
      result: `Needs root on the box: sudo asks for a password here, so ${unit} was not restarted. This works once the on-box agent (runs as root) exists.`,
    };
  }
  const exit = field(lines, 'restart exit');
  const after = pair(field(lines, 'after'));
  const active = field(lines, 'active');
  if (exit !== '0')
    return { state: 'FAILED', result: `systemctl restart ${unit} failed (exit ${exit ?? '?'}).` };
  if (!after || active !== 'active') {
    return {
      state: 'FAILED',
      result: `Restarted ${unit} but ComfyUI did not come back within 60 s (service: ${active ?? 'unknown'}).`,
    };
  }
  return {
    state: 'SUCCEEDED',
    result: `Restarted ${unit}. ComfyUI answered again with ${after.running} running, ${after.pending} pending.`,
  };
}
