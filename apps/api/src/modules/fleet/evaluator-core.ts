import {
  type AgentTelemetry,
  FLEET_ALERT_RULES,
  FLEET_SYSTEM_STALE_MS,
  type FleetAlertRuleKey,
} from '@aivastra/types';
import { deriveGpuSignals } from './signals.js';

// Pure half of the alert evaluator: given what we can observe about one worker, decide for each
// rule whether the condition holds, and given the hysteresis state, whether to open or recover an
// incident. No I/O here, so every branch is testable with plain objects and a fake clock.

export type Evidence = Record<string, string | number | boolean | null>;

/**
 * breach  = the condition holds right now
 * ok      = the inputs are known and the condition does not hold
 * unknown = the inputs are missing or stale. Unknown never opens an incident and never counts
 *           toward recovery: a vanished sensor is not evidence that a problem went away.
 */
export type Observation =
  | { status: 'breach'; summary: string; evidence: Evidence }
  | { status: 'ok' }
  | { status: 'unknown' };

export type DispatcherView = 'reachable' | 'unreachable' | 'unknown';

export type WorkerContext = {
  now: number;
  /** A heartbeat key exists in Redis (an ingest was accepted in the last 90 s). */
  agentAlive: boolean;
  /** When the server last accepted a sample from any key, or null if one never connected. */
  agentLastSeenAt: number | null;
  /** What the dispatcher's own probes say about ComfyUI on this worker. */
  dispatcher: DispatcherView;
  /** Latest accepted sample, or null when none within its TTL. */
  telemetry: AgentTelemetry | null;
  clockSkewMs: number | null;
  rejectsLastHour: number;
};

export type RuleParams = Record<string, number>;

const NOT_YET: Observation = { status: 'unknown' };

function freshTelemetry(ctx: WorkerContext): AgentTelemetry | null {
  const t = ctx.telemetry;
  if (!t) return null;
  return ctx.now - t.observedAt > FLEET_SYSTEM_STALE_MS ? null : t;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Parameter with the catalog default as the floor of trust if a stored value is missing. */
export function paramOf(key: FleetAlertRuleKey, params: RuleParams, name: string): number {
  const stored = params[name];
  if (typeof stored === 'number' && Number.isFinite(stored)) return stored;
  const def = (FLEET_ALERT_RULES[key].params as Record<string, { default: number }>)[name];
  return def?.default ?? Number.NaN;
}

export function observe(
  key: FleetAlertRuleKey,
  ctx: WorkerContext,
  params: RuleParams,
): Observation {
  const p = (name: string) => paramOf(key, params, name);
  const t = freshTelemetry(ctx);

  switch (key) {
    case 'agent_silent': {
      // A key that never connected is "not deployed yet", which the Agent tab already says.
      if (ctx.agentLastSeenAt === null) return NOT_YET;
      if (ctx.agentAlive) return { status: 'ok' };
      return {
        status: 'breach',
        summary: 'The fleet agent has stopped reporting.',
        evidence: {
          lastSeenSecondsAgo: Math.round((ctx.now - ctx.agentLastSeenAt) / 1000),
        },
      };
    }

    case 'comfy_down_box_up': {
      if (!ctx.agentAlive || ctx.dispatcher === 'unknown') return NOT_YET;
      if (ctx.dispatcher === 'reachable') return { status: 'ok' };
      return {
        status: 'breach',
        summary: 'The box is alive but the dispatcher cannot reach ComfyUI.',
        evidence: { agentAlive: true, dispatcherReachesComfy: false },
      };
    }

    case 'box_unreachable': {
      if (ctx.agentLastSeenAt === null || ctx.dispatcher === 'unknown') return NOT_YET;
      if (ctx.agentAlive || ctx.dispatcher === 'reachable') return { status: 'ok' };
      return {
        status: 'breach',
        summary: 'Neither the agent nor the dispatcher can reach this box.',
        evidence: {
          agentAlive: false,
          dispatcherReachesComfy: false,
          lastSeenSecondsAgo: Math.round((ctx.now - ctx.agentLastSeenAt) / 1000),
        },
      };
    }

    case 'thermal_collapse': {
      if (!t) return NOT_YET;
      const signals = deriveGpuSignals(t);
      const ratioBelow = p('clockRatioBelow');
      const tempAtLeast = p('tempAtLeastC');
      let known = 0;
      for (const s of signals) {
        const gpu = t.gpus.find((g) => g.index === s.index);
        if (!gpu || s.clockRatio === null || gpu.tempC === null) continue;
        known++;
        if (s.clockRatio < ratioBelow && gpu.tempC >= tempAtLeast) {
          return {
            status: 'breach',
            summary: `GPU ${gpu.index} is at ${gpu.tempC} C with its clock at ${Math.round(s.clockRatio * 100)}% of maximum.`,
            evidence: {
              gpuIndex: gpu.index,
              tempC: gpu.tempC,
              clockRatio: s.clockRatio,
              smClockMhz: gpu.smClockMhz,
              smClockMaxMhz: gpu.smClockMaxMhz,
            },
          };
        }
      }
      return known > 0 ? { status: 'ok' } : NOT_YET;
    }

    case 'gpu_temp_high': {
      if (!t) return NOT_YET;
      const limit = p('tempAtLeastC');
      let known = 0;
      for (const gpu of t.gpus) {
        if (gpu.tempC === null) continue;
        known++;
        if (gpu.tempC >= limit) {
          return {
            status: 'breach',
            summary: `GPU ${gpu.index} is at ${gpu.tempC} C.`,
            evidence: { gpuIndex: gpu.index, tempC: gpu.tempC, limitC: limit },
          };
        }
      }
      return known > 0 ? { status: 'ok' } : NOT_YET;
    }

    case 'disk_high': {
      if (!t) return NOT_YET;
      const usedLimit = p('usedPctAtLeast');
      const inodeLimit = p('inodePctAtLeast');
      let known = 0;
      for (const d of t.host.disks) {
        const usedPct =
          d.totalGb !== null && d.usedGb !== null && d.totalGb > 0
            ? (d.usedGb / d.totalGb) * 100
            : null;
        if (usedPct === null && d.inodeUsedPct === null) continue;
        known++;
        if (usedPct !== null && usedPct >= usedLimit) {
          return {
            status: 'breach',
            summary: `Disk ${d.mount} is ${round1(usedPct)}% full.`,
            evidence: { mount: d.mount, usedPct: round1(usedPct), limitPct: usedLimit },
          };
        }
        if (d.inodeUsedPct !== null && d.inodeUsedPct >= inodeLimit) {
          return {
            status: 'breach',
            summary: `Disk ${d.mount} has used ${round1(d.inodeUsedPct)}% of its inodes.`,
            evidence: {
              mount: d.mount,
              inodeUsedPct: round1(d.inodeUsedPct),
              limitPct: inodeLimit,
            },
          };
        }
      }
      return known > 0 ? { status: 'ok' } : NOT_YET;
    }

    case 'swap_active': {
      const used = t?.host.swapUsedMib ?? null;
      if (used === null) return NOT_YET;
      const limit = p('swapUsedMibAbove');
      if (used <= limit) return { status: 'ok' };
      return {
        status: 'breach',
        summary: `The box is using ${used} MiB of swap.`,
        evidence: { swapUsedMib: used, limitMib: limit, ramAvailMib: t?.host.ramAvailMib ?? null },
      };
    }

    case 'ram_low': {
      const total = t?.host.ramTotalMib ?? null;
      const avail = t?.host.ramAvailMib ?? null;
      if (total === null || avail === null || total <= 0) return NOT_YET;
      const availPct = (avail / total) * 100;
      const limit = p('availablePctBelow');
      if (availPct >= limit) return { status: 'ok' };
      return {
        status: 'breach',
        summary: `Only ${round1(availPct)}% of RAM is available.`,
        evidence: {
          ramAvailMib: avail,
          ramTotalMib: total,
          availablePct: round1(availPct),
          limitPct: limit,
        },
      };
    }

    case 'foreign_vram': {
      if (!t) return NOT_YET;
      const limit = p('foreignMibAbove');
      let known = 0;
      for (const s of deriveGpuSignals(t)) {
        // null = per-process data not visible (shared pods): unknown, not zero and not "all foreign".
        if (s.foreignVramMib === null) continue;
        known++;
        if (s.foreignVramMib > limit) {
          return {
            status: 'breach',
            summary: `GPU ${s.index} holds ${s.foreignVramMib} MiB that this worker does not own.`,
            evidence: { gpuIndex: s.index, foreignVramMib: s.foreignVramMib, limitMib: limit },
          };
        }
      }
      return known > 0 ? { status: 'ok' } : NOT_YET;
    }

    case 'clock_skew': {
      if (ctx.clockSkewMs === null || !t) return NOT_YET;
      const skewS = Math.abs(ctx.clockSkewMs) / 1000;
      const limit = p('skewSecondsAbove');
      if (skewS <= limit) return { status: 'ok' };
      return {
        status: 'breach',
        summary: `The box clock differs from the server by about ${Math.round(skewS)} s.`,
        evidence: {
          skewSeconds: Math.round(skewS),
          limitSeconds: limit,
          ntpSynced: t.host.ntpSynced,
        },
      };
    }

    case 'ingest_rejected': {
      // The counter expires an hour after its first increment, so this self-clears.
      const limit = p('rejectsAtLeast');
      if (ctx.rejectsLastHour < limit) return { status: 'ok' };
      return {
        status: 'breach',
        summary: `${ctx.rejectsLastHour} samples were refused in the last hour.`,
        evidence: { rejectsLastHour: ctx.rejectsLastHour, limit },
      };
    }
  }
}

// ---- Hysteresis -------------------------------------------------------------------------------

export type Hysteresis = { pendingSince: number | null; clearSince: number | null };
export const EMPTY_HYSTERESIS: Hysteresis = { pendingSince: null, clearSince: null };

export type Decision = { next: Hysteresis; action: 'open' | 'recover' | 'none' };

/**
 * `forMs` is how long a breach must last before an incident opens; `clearMs` how long the
 * condition must be clear before it recovers. One bad sample therefore opens nothing, and one
 * good sample recovers nothing: a flapping signal stays in whichever state it was already in.
 */
export function decide(args: {
  obs: Observation;
  live: boolean;
  state: Hysteresis;
  now: number;
  forMs: number;
  clearMs: number;
}): Decision {
  const { obs, live, state, now, forMs, clearMs } = args;

  if (obs.status === 'unknown') {
    // A gap in the data ends the pending window (two breaches an hour apart must not add up) and,
    // for a live incident, restarts clearing: it stays open until the data says it is clear.
    return { next: EMPTY_HYSTERESIS, action: 'none' };
  }

  if (obs.status === 'breach') {
    if (live) return { next: EMPTY_HYSTERESIS, action: 'none' };
    const since = state.pendingSince ?? now;
    if (now - since >= forMs) return { next: EMPTY_HYSTERESIS, action: 'open' };
    return { next: { pendingSince: since, clearSince: null }, action: 'none' };
  }

  // ok
  if (!live) return { next: EMPTY_HYSTERESIS, action: 'none' };
  const since = state.clearSince ?? now;
  if (now - since >= clearMs) return { next: EMPTY_HYSTERESIS, action: 'recover' };
  return { next: { pendingSince: null, clearSince: since }, action: 'none' };
}
