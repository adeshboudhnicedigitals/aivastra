import type { FleetWorkerView } from './contracts';
import type { FleetAgentSummary } from './live-agent';

// How the overview combines what the dispatcher sees with what the agent reports from the box.
// The two are independent observations and are never merged into one number: when they disagree
// both are shown, because "the box is up but the dispatcher cannot reach ComfyUI" is exactly the
// fault an operator needs to see.

/**
 * A worker that accepts no job types takes no part in dispatch, so the dispatcher's health and
 * reachability for it say nothing about the box. This is the case for rows that exist only to
 * attach telemetry (the local SSH collector creates them).
 */
export function isTelemetryOnly(worker: Pick<FleetWorkerView, 'jobTypes'>): boolean {
  return worker.jobTypes.length === 0;
}

const freshAgent = (summary: FleetAgentSummary | undefined) =>
  summary?.telemetry && !summary.telemetry.stale ? summary.telemetry : null;

export function agentHasFreshTelemetry(summary: FleetAgentSummary | undefined): boolean {
  return freshAgent(summary) !== null;
}

export type ComfyView = {
  /** Main line. */
  headline: string;
  /** Where the headline came from. */
  source: 'agent' | 'dispatcher' | 'both' | 'none';
  /** The dispatcher and the agent give opposite answers. */
  conflict: boolean;
  /** Second line, when there is one. */
  detail: string | null;
};

const counts = (running: number | null, pending: number | null) =>
  `${running === null ? 'unknown' : running} running · ${pending === null ? 'unknown' : pending} pending`;

export function comfyView(
  worker: Pick<FleetWorkerView, 'comfy' | 'jobTypes'>,
  summary: FleetAgentSummary | undefined,
): ComfyView {
  const dispatcher =
    isTelemetryOnly(worker) || worker.comfy.reachable === null ? null : worker.comfy;
  const agentComfy = freshAgent(summary)?.comfy ?? null;
  const agent = agentComfy && agentComfy.reachable !== null ? agentComfy : null;

  if (dispatcher && agent && dispatcher.reachable !== agent.reachable) {
    const d = dispatcher.reachable ? 'reachable' : 'cannot reach it';
    const a = agent.reachable ? 'reachable on the box' : 'not answering on the box';
    return {
      headline: `Agent: ${a} · Dispatcher: ${d}`,
      source: 'both',
      conflict: true,
      detail: 'The two observations disagree.',
    };
  }
  if (dispatcher) {
    return {
      headline: dispatcher.reachable
        ? counts(dispatcher.running, dispatcher.pending)
        : 'Unreachable (dispatcher)',
      source: agent ? 'both' : 'dispatcher',
      conflict: false,
      detail: null,
    };
  }
  if (agent) {
    return {
      headline: agent.reachable
        ? `Reachable · ${counts(agent.running, agent.pending)}`
        : 'Not answering on the box',
      source: 'agent',
      conflict: false,
      detail: 'Seen by the agent on the box',
    };
  }
  return { headline: 'Reachability unknown', source: 'none', conflict: false, detail: null };
}

export function dispatcherLabel(
  worker: Pick<FleetWorkerView, 'jobTypes' | 'inRegistry'>,
): string | null {
  if (isTelemetryOnly(worker)) return 'Not part of dispatch (accepts no job types)';
  if (!worker.inRegistry) return 'Not seen by the dispatcher';
  return null;
}

export type FleetTiles = {
  dispatchWorkers: number;
  healthy: number;
  unreachable: number;
  withFreshTelemetry: number;
  withoutTelemetry: number;
  agentMonitored: number;
  agentReporting: number;
  vram: { usedMib: number; totalMib: number; boxes: number } | null;
};

export function fleetTiles(
  workers: (Pick<FleetWorkerView, 'workerId' | 'jobTypes' | 'health'> & {
    dispatcherTelemetryFresh: boolean;
  })[],
  summaries: FleetAgentSummary[] | null,
): FleetTiles {
  const byId = new Map((summaries ?? []).map((s) => [s.workerId, s]));
  const dispatch = workers.filter((w) => !isTelemetryOnly(w));
  const withFresh = workers.filter(
    (w) => w.dispatcherTelemetryFresh || agentHasFreshTelemetry(byId.get(w.workerId)),
  );
  // Per-box device memory, summed only over boxes whose agent sample is fresh and complete.
  let used = 0;
  let total = 0;
  let boxes = 0;
  for (const s of summaries ?? []) {
    const t = freshAgent(s);
    if (t && t.vramUsedMib !== null && t.vramTotalMib !== null) {
      used += t.vramUsedMib;
      total += t.vramTotalMib;
      boxes++;
    }
  }
  return {
    dispatchWorkers: dispatch.length,
    healthy: dispatch.filter((w) => w.health === 'HEALTHY').length,
    unreachable: dispatch.filter((w) => w.health === 'UNREACHABLE').length,
    withFreshTelemetry: withFresh.length,
    withoutTelemetry: workers.length - withFresh.length,
    agentMonitored: summaries?.length ?? 0,
    agentReporting: (summaries ?? []).filter((s) => agentHasFreshTelemetry(s)).length,
    vram: boxes > 0 ? { usedMib: used, totalMib: total, boxes } : null,
  };
}
