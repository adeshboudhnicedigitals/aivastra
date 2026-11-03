import type { FleetCommandKind } from '@aivastra/types';

// Pure half of the control commands: may this command run on this worker right now? Every rule here
// exists because the action would otherwise destroy work the dispatcher is still tracking, so
// anything unknown is refused: "I could not tell" is not permission.

export type QueueCounts = { running: number | null; pending: number | null };

export type CommandContext = {
  /** The dispatcher registry's status for the worker, or null if it is not registered. */
  dispatcherStatus: string | null;
  /** A job's reservation still holds the worker (the dispatcher has remote work unresolved). */
  reserved: boolean;
  /** Dispatcher's own fresh probe of ComfyUI's queue, or null when missing/stale/failed. */
  dispatcherQueue: QueueCounts | null;
  /** The agent's fresh reading of ComfyUI's queue, or null when missing/stale. */
  agentQueue: QueueCounts | null;
};

export type Verdict = { ok: true } | { ok: false; reason: string };
const no = (reason: string): Verdict => ({ ok: false, reason });

const known = (n: number | null): n is number => typeof n === 'number';

export function checkCommand(kind: FleetCommandKind, ctx: CommandContext): Verdict {
  if (ctx.dispatcherStatus === null) return no('The dispatcher does not know this worker.');
  // DRAINING is what stops new jobs arriving while the command runs. Nothing else is safe: an
  // IDLE worker can be handed a job the moment the check passes.
  if (ctx.dispatcherStatus !== 'DRAINING') {
    return no('Drain the worker first: a command must not race a job being dispatched to it.');
  }
  if (ctx.reserved) {
    return no('A job still holds this worker (unresolved reservation). Wait for it to finish.');
  }

  const pendings = [ctx.dispatcherQueue?.pending, ctx.agentQueue?.pending].filter(
    (n): n is number => known(n ?? null),
  );
  const runnings = [ctx.dispatcherQueue?.running, ctx.agentQueue?.running].filter(
    (n): n is number => known(n ?? null),
  );

  if (kind === 'restart_comfyui') {
    // Both observers must have answered: a restart kills the running prompt, and either side's
    // silence could be hiding one.
    if (
      !ctx.dispatcherQueue ||
      !known(ctx.dispatcherQueue.running) ||
      !known(ctx.dispatcherQueue.pending)
    ) {
      return no(
        'The dispatcher has no fresh reading of this worker queue, so a restart is not safe.',
      );
    }
    if (!ctx.agentQueue || !known(ctx.agentQueue.running) || !known(ctx.agentQueue.pending)) {
      return no('The agent has no fresh reading of this worker queue, so a restart is not safe.');
    }
    const busy = Math.max(...runnings, ...pendings);
    if (busy > 0) {
      return no(
        `ComfyUI still has work (${Math.max(...runnings)} running, ${Math.max(...pendings)} pending). A restart would kill it.`,
      );
    }
    return { ok: true };
  }

  // clear_queue drops pending prompts only; a running prompt is left alone.
  if (pendings.length === 0) {
    return no('Nobody has a fresh reading of this worker queue, so there is nothing to act on.');
  }
  if (Math.max(...pendings) === 0) return no('The queue is already empty: nothing to clear.');
  return { ok: true };
}
