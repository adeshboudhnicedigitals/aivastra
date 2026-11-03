import type { AgentTelemetry } from '@aivastra/types';
import { describe, expect, it } from 'vitest';
import {
  decide,
  EMPTY_HYSTERESIS,
  type Hysteresis,
  type Observation,
  observe,
  type WorkerContext,
} from '../src/modules/fleet/evaluator-core';

const NOW = 1_800_000_000_000;

function telemetry(over: Partial<AgentTelemetry> = {}): AgentTelemetry {
  return {
    v: 1,
    workerId: 'w1',
    agentVersion: '0.1.0',
    bootId: 'boot-0001',
    seq: 1,
    observedAt: NOW - 5_000,
    gpus: [
      {
        index: 0,
        name: 'RTX',
        tempC: 60,
        memTempC: null,
        fanPct: null,
        pstate: 'P2',
        smClockMhz: 2400,
        smClockMaxMhz: 2400,
        memClockMhz: null,
        powerW: 200,
        powerLimitW: 450,
        utilGpuPct: 90,
        utilMemPct: 50,
        vramUsedMib: 10000,
        vramTotalMib: 24000,
        throttleReasons: '0x0000000000000000',
        eccUncorrected: null,
      },
    ],
    computeApps: [],
    host: {
      cpuCount: 8,
      load1: 1,
      load5: 1,
      load15: 1,
      ramTotalMib: 64000,
      ramAvailMib: 40000,
      swapTotalMib: 8000,
      swapUsedMib: 0,
      memPsiSome10: 0,
      uptimeSec: 1000,
      ntpSynced: true,
      disks: [{ mount: '/', totalGb: 500, usedGb: 100, inodeUsedPct: 5 }],
    },
    services: [],
    comfy: [],
    ...over,
  };
}

function ctx(over: Partial<WorkerContext> = {}): WorkerContext {
  return {
    now: NOW,
    agentAlive: true,
    agentLastSeenAt: NOW - 5_000,
    dispatcher: 'reachable',
    telemetry: telemetry(),
    clockSkewMs: 200,
    rejectsLastHour: 0,
    ...over,
  };
}

const withGpu = (patch: Partial<AgentTelemetry['gpus'][number]>) => {
  const t = telemetry();
  return telemetry({ gpus: [{ ...t.gpus[0], ...patch } as AgentTelemetry['gpus'][number]] });
};
const withHost = (patch: Partial<AgentTelemetry['host']>) => {
  const t = telemetry();
  return telemetry({ host: { ...t.host, ...patch } });
};

describe('observe', () => {
  it('is ok for a healthy box on every telemetry rule', () => {
    for (const k of [
      'thermal_collapse',
      'gpu_temp_high',
      'disk_high',
      'swap_active',
      'ram_low',
      'clock_skew',
      'ingest_rejected',
      'agent_silent',
      'comfy_down_box_up',
      'box_unreachable',
    ] as const) {
      expect(observe(k, ctx(), {}).status, k).toBe('ok');
    }
  });

  it('treats stale or missing telemetry as unknown, never ok', () => {
    for (const telem of [null, telemetry({ observedAt: NOW - 10 * 60_000 })]) {
      for (const k of [
        'thermal_collapse',
        'gpu_temp_high',
        'disk_high',
        'swap_active',
        'ram_low',
      ] as const) {
        expect(observe(k, ctx({ telemetry: telem }), {}).status, k).toBe('unknown');
      }
    }
  });

  it('thermal_collapse needs both a hot GPU and a collapsed clock', () => {
    const hotSlow = observe(
      'thermal_collapse',
      ctx({ telemetry: withGpu({ tempC: 86, smClockMhz: 900 }) }),
      {},
    );
    expect(hotSlow.status).toBe('breach');
    if (hotSlow.status === 'breach')
      expect(hotSlow.evidence).toMatchObject({ gpuIndex: 0, tempC: 86 });
    // slow but cool (idle downclock), hot but at full clock
    expect(
      observe('thermal_collapse', ctx({ telemetry: withGpu({ tempC: 50, smClockMhz: 300 }) }), {})
        .status,
    ).toBe('ok');
    expect(observe('thermal_collapse', ctx({ telemetry: withGpu({ tempC: 90 }) }), {}).status).toBe(
      'ok',
    );
    // unknown inputs are unknown
    expect(
      observe('thermal_collapse', ctx({ telemetry: withGpu({ smClockMhz: null }) }), {}).status,
    ).toBe('unknown');
  });

  it('honours tuned parameters', () => {
    const t = withGpu({ tempC: 70, smClockMhz: 900 });
    expect(observe('thermal_collapse', ctx({ telemetry: t }), {}).status).toBe('ok');
    expect(observe('thermal_collapse', ctx({ telemetry: t }), { tempAtLeastC: 65 }).status).toBe(
      'breach',
    );
  });

  it('disk_high checks space and inodes, and skips disks with no data', () => {
    expect(
      observe(
        'disk_high',
        ctx({
          telemetry: withHost({
            disks: [{ mount: '/', totalGb: 100, usedGb: 95, inodeUsedPct: 1 }],
          }),
        }),
        {},
      ).status,
    ).toBe('breach');
    expect(
      observe(
        'disk_high',
        ctx({
          telemetry: withHost({
            disks: [{ mount: '/', totalGb: 100, usedGb: 10, inodeUsedPct: 97 }],
          }),
        }),
        {},
      ).status,
    ).toBe('breach');
    expect(
      observe(
        'disk_high',
        ctx({
          telemetry: withHost({
            disks: [{ mount: '/', totalGb: null, usedGb: null, inodeUsedPct: null }],
          }),
        }),
        {},
      ).status,
    ).toBe('unknown');
    expect(observe('disk_high', ctx({ telemetry: withHost({ disks: [] }) }), {}).status).toBe(
      'unknown',
    );
  });

  it('swap, ram and skew', () => {
    expect(
      observe('swap_active', ctx({ telemetry: withHost({ swapUsedMib: 2000 }) }), {}).status,
    ).toBe('breach');
    expect(
      observe('swap_active', ctx({ telemetry: withHost({ swapUsedMib: null }) }), {}).status,
    ).toBe('unknown');
    expect(observe('ram_low', ctx({ telemetry: withHost({ ramAvailMib: 3000 }) }), {}).status).toBe(
      'breach',
    );
    expect(observe('ram_low', ctx({ telemetry: withHost({ ramTotalMib: 0 }) }), {}).status).toBe(
      'unknown',
    );
    expect(observe('clock_skew', ctx({ clockSkewMs: -45_000 }), {}).status).toBe('breach');
    expect(observe('clock_skew', ctx({ clockSkewMs: null }), {}).status).toBe('unknown');
  });

  it('foreign_vram stays unknown when per-process data is not visible', () => {
    // No compute apps visible (shared pod): unknown, not "all foreign".
    expect(observe('foreign_vram', ctx(), {}).status).toBe('unknown');
    const visible = telemetry({
      gpus: [{ ...telemetry().gpus[0], vramUsedMib: 20000 } as AgentTelemetry['gpus'][number]],
      computeApps: [{ gpuIndex: 0, name: 'python', vramMib: 10000 }],
    });
    expect(observe('foreign_vram', ctx({ telemetry: visible }), {}).status).toBe('breach');
  });

  it('agent and dispatcher rules distinguish the three situations', () => {
    // never connected: nothing to say
    expect(
      observe('agent_silent', ctx({ agentAlive: false, agentLastSeenAt: null }), {}).status,
    ).toBe('unknown');
    // silent
    const silent = ctx({ agentAlive: false, agentLastSeenAt: NOW - 200_000, telemetry: null });
    expect(observe('agent_silent', silent, {}).status).toBe('breach');
    // comfy down, box up
    expect(observe('comfy_down_box_up', ctx({ dispatcher: 'unreachable' }), {}).status).toBe(
      'breach',
    );
    expect(observe('comfy_down_box_up', ctx({ dispatcher: 'unknown' }), {}).status).toBe('unknown');
    expect(observe('comfy_down_box_up', silent, {}).status).toBe('unknown');
    // box unreachable only when both channels are dead
    expect(observe('box_unreachable', { ...silent, dispatcher: 'unreachable' }, {}).status).toBe(
      'breach',
    );
    expect(observe('box_unreachable', { ...silent, dispatcher: 'reachable' }, {}).status).toBe(
      'ok',
    );
    expect(observe('box_unreachable', { ...silent, dispatcher: 'unknown' }, {}).status).toBe(
      'unknown',
    );
  });

  it('ingest_rejected compares the hourly counter with the limit', () => {
    expect(observe('ingest_rejected', ctx({ rejectsLastHour: 9 }), {}).status).toBe('ok');
    expect(observe('ingest_rejected', ctx({ rejectsLastHour: 10 }), {}).status).toBe('breach');
  });
});

describe('thermal_slowdown', () => {
  it('is unknown without a counter reading, never ok', () => {
    expect(observe('thermal_slowdown', ctx({ thermalSlowedMs: null }), {}).status).toBe('unknown');
    expect(observe('thermal_slowdown', ctx(), {}).status).toBe('unknown');
  });

  it('breaches above the limit, with evidence, and is ok at or below it', () => {
    const over = observe('thermal_slowdown', ctx({ thermalSlowedMs: 31_000 }), {});
    expect(over).toMatchObject({
      status: 'breach',
      evidence: { slowedSeconds: 31, limitSeconds: 30, windowMinutes: 15 },
    });
    expect(observe('thermal_slowdown', ctx({ thermalSlowedMs: 30_000 }), {}).status).toBe('ok');
    expect(observe('thermal_slowdown', ctx({ thermalSlowedMs: 0 }), {}).status).toBe('ok');
  });

  it('honours a tuned limit', () => {
    const c = ctx({ thermalSlowedMs: 10_000 });
    expect(observe('thermal_slowdown', c, {}).status).toBe('ok');
    expect(observe('thermal_slowdown', c, { slowedSecondsAbove: 5 }).status).toBe('breach');
  });
});

describe('decide (hysteresis)', () => {
  const breach: Observation = { status: 'breach', summary: 's', evidence: {} };
  const ok: Observation = { status: 'ok' };
  const unknown: Observation = { status: 'unknown' };
  const FOR = 180_000;
  const CLEAR = 120_000;
  const step = (obs: Observation, live: boolean, state: Hysteresis, now: number) =>
    decide({ obs, live, state, now, forMs: FOR, clearMs: CLEAR });

  it('does not open on a single breach, opens once it has lasted the window', () => {
    let d = step(breach, false, EMPTY_HYSTERESIS, NOW);
    expect(d.action).toBe('none');
    expect(d.next.pendingSince).toBe(NOW);
    d = step(breach, false, d.next, NOW + FOR - 1);
    expect(d.action).toBe('none');
    d = step(breach, false, d.next, NOW + FOR);
    expect(d.action).toBe('open');
    expect(d.next).toEqual(EMPTY_HYSTERESIS);
  });

  it('a flapping signal never opens', () => {
    let state = EMPTY_HYSTERESIS;
    for (let i = 0; i < 40; i++) {
      const d = step(i % 2 === 0 ? breach : ok, false, state, NOW + i * 15_000);
      expect(d.action).toBe('none');
      state = d.next;
    }
  });

  it('a gap in the data ends the pending window', () => {
    let d = step(breach, false, EMPTY_HYSTERESIS, NOW);
    d = step(unknown, false, d.next, NOW + 60_000);
    expect(d.next.pendingSince).toBeNull();
    d = step(breach, false, d.next, NOW + FOR + 1);
    expect(d.action).toBe('none'); // restarted, not carried over
  });

  it('recovers only after the condition has been clear for the whole window', () => {
    let d = step(ok, true, EMPTY_HYSTERESIS, NOW);
    expect(d.action).toBe('none');
    d = step(ok, true, d.next, NOW + CLEAR - 1);
    expect(d.action).toBe('none');
    d = step(ok, true, d.next, NOW + CLEAR);
    expect(d.action).toBe('recover');
  });

  it('a relapse during clearing restarts the clear window', () => {
    let d = step(ok, true, EMPTY_HYSTERESIS, NOW);
    d = step(breach, true, d.next, NOW + 60_000);
    expect(d.next.clearSince).toBeNull();
    d = step(ok, true, d.next, NOW + 70_000);
    d = step(ok, true, d.next, NOW + 70_000 + CLEAR - 1);
    expect(d.action).toBe('none');
  });

  it('unknown never recovers a live incident', () => {
    let state = EMPTY_HYSTERESIS;
    for (let i = 0; i < 100; i++) {
      const d = step(unknown, true, state, NOW + i * 60_000);
      expect(d.action).toBe('none');
      state = d.next;
    }
  });

  it('a zero window (ingest_rejected) opens on the first breach', () => {
    const d = decide({
      obs: breach,
      live: false,
      state: EMPTY_HYSTERESIS,
      now: NOW,
      forMs: 0,
      clearMs: 0,
    });
    expect(d.action).toBe('open');
  });
});
